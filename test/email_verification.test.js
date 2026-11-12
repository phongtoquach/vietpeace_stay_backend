const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const sql = require('mssql');
const bcrypt = require('bcryptjs');
function load(file, deps, extra = {}) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        module, Buffer, URL, URLSearchParams, console: { log() {} }, require: name => { assert.ok(name in deps, name); return deps[name]; }, ...extra
    });
    return module.exports;
}
function fixture(options = {}) {
    const state = { status: options.status ?? 0, used: options.used ?? false, committed: 0, rolledBack: 0, sent: [], queries: [], token: 'a'.repeat(64) };
    class Transaction {
        async begin() { this.snapshot = { status: state.status, used: state.used }; }
        async commit() { state.committed++; }
        async rollback() { Object.assign(state, this.snapshot); state.rolledBack++; }
    }
    class Request {
        constructor(tx) { this.tx = tx; this.inputs = {}; }
        input(name, type, value) { this.inputs[name] = value; return this; }
        async query(text) {
            state.queries.push({ text, inputs: this.inputs });
            if (text.includes('INSERT INTO dbo.users')) return { recordset: [{ id: 'user', email: this.inputs.email, full_name: 'Person' }] };
            if (text.includes('INSERT INTO dbo.email_verification_tokens')) {
                if (options.tokenFailure) throw Error('DB secret');
                assert.match(text, /DATEADD\(HOUR, 24, @now\)/);
                assert.match(text, /expires_at, created_at/);
                state.hash = this.inputs.token_hash;
                return { recordset: [] };
            }
            if (text.includes('SELECT user_id')) return { recordset: options.unknown ? [] : [{ user_id: 'user' }] };
            if (text.includes('UPDLOCK')) {
                assert.ok(this.tx);
                assert.match(text, /role = 'CUSTOMER' AND status = 0/);
                return { recordset: state.status === 0 && !options.admin ? [{ id: 'user' }] : [] };
            }
            if (text.includes('UPDATE t SET used_at')) {
                assert.ok(this.tx);
                assert.match(text, /u.email = t.email/);
                assert.match(text, /t.used_at IS NULL AND t.revoked_at IS NULL/);
                assert.match(text, /t.expires_at > @now/);
                if (state.used || options.expired || options.revoked || options.emailChanged) return { recordset: [] };
                state.used = true;
                return { recordset: [{ id: 1 }] };
            }
            if (text.includes('UPDATE dbo.users')) {
                assert.ok(this.tx);
                if (options.activationFailure) throw Error('DB secret');
                state.status = 1;
                return { recordset: [{ id: 'user' }] };
            }
            return { recordset: [] };
        }
    }
    const service = load('services/user_web_service.js', {
        mssql: { ...sql, Request, Transaction }, bcryptjs: bcrypt, 'node:crypto': crypto,
        '../configs/database': { getDBPool: () => ({ request: () => new Request() }) },
        './email_service': { createVerificationSender: () => async (email, token) => {
            if (options.mailFailure) throw Error('SMTP secret');
            state.sent.push({ email, token });
        } }
    });
    return { service, state };
}
const registration = { email: ' Person@Example.com ', password: 'password123', full_name: 'Person', display_name: 'Person' };
test('registration persists hash only and sends raw token to registered email', async () => {
    const { service, state } = fixture();
    const result = await service.register(registration);
    assert.equal(result.verification.emailSent, true);
    assert.equal(state.sent[0].email, 'person@example.com');
    assert.match(state.sent[0].token, /^[a-f0-9]{64}$/);
    assert.equal(state.hash, crypto.createHash('sha256').update(state.sent[0].token).digest('hex'));
    assert.ok(!JSON.stringify(state.queries).includes(state.sent[0].token));
    assert.ok(!JSON.stringify(result).includes(state.sent[0].token));
    assert.equal(state.status, 0);
});
for (const option of ['mailFailure', 'tokenFailure']) test(`${option}: pending account, honest delivery status`, async () => {
    const { service, state } = fixture({ [option]: true });
    const result = await service.register(registration);
    assert.equal(result.success, true);
    assert.equal(result.verification.emailSent, false);
    assert.equal(state.status, 0);
    assert.equal(state.sent.length, 0);
});
test('valid token activates once', async () => {
    const { service, state } = fixture();
    assert.equal(await service.verifyEmail(state.token), true);
    assert.equal(state.used, true);
    assert.equal(state.status, 1);
    assert.equal(await service.verifyEmail(state.token), false);
});
for (const option of ['unknown', 'expired', 'used', 'revoked', 'admin', 'emailChanged']) test(`${option}: no activation`, async () => {
    const { service, state } = fixture({ [option]: true });
    assert.equal(await service.verifyEmail(state.token), false);
    assert.equal(state.status, 0);
});
for (const status of [1, 2]) test(`status ${status} cannot activate`, async () => {
    const { service, state } = fixture({ status });
    assert.equal(await service.verifyEmail(state.token), false);
    assert.equal(state.status, status);
});
test('invalid token rejected before DB access', async () => {
    const { service, state } = fixture();
    assert.equal(await service.verifyEmail('bad'), false);
    assert.equal(state.queries.length, 0);
});
test('activation failure rolls back token use', async () => {
    const { service, state } = fixture({ activationFailure: true });
    await assert.rejects(service.verifyEmail(state.token));
    assert.equal(state.rolledBack, 1);
    assert.equal(state.used, false);
    assert.equal(state.status, 0);
});
test('login respects pending, active and inactive statuses', async () => {
    const user = { id: 'user', email: 'person@example.com', password_hash: await bcrypt.hash('password123', 4), role: 'CUSTOMER', status: 0 };
    const service = load('services/auth_service.js', {
        mssql: sql, bcryptjs: bcrypt, './user_web_service': { register() {} },
        '../configs/database': { getDBPool: () => ({ request: () => ({ input() { return this; }, async query(text) { return { recordset: text.includes('UPDATE') ? [{ last_login_at: new Date() }] : [user] }; } }) }) }
    });
    for (const [status, code] of [[0, 'EMAIL_NOT_VERIFIED'], [1, null], [2, 'ACCOUNT_INACTIVE']]) {
        user.status = status;
        const result = await service.login({ email: user.email, password: 'password123' });
        if (code) assert.equal(result.errorCode, code); else assert.equal(result.success, true);
    }
});
for (const rejected of [false, true]) test(`SMTP adapter rejection=${rejected}`, async () => {
    let mail;
    const service = load('services/email_service.js', { nodemailer: { createTransport: config => {
        assert.equal(config.debug, false); assert.equal(config.requireTLS, true);
        return { close() {}, async sendMail(value) { mail = value; return { accepted: rejected ? [] : ['person@example.com'], rejected: rejected ? ['person@example.com'] : [] }; } };
    } } }, { process: { env: { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '587', MAIL_FROM: 'no-reply@example.com', CUSTOMER_WEB_VERIFY_URL: 'https://example.com/verify-email' } } });
    const send = service.createVerificationSender();
    if (rejected) await assert.rejects(send('person@example.com', 'a'.repeat(64)));
    else await send('person@example.com', 'a'.repeat(64));
    assert.equal(mail.to, 'person@example.com');
    assert.equal(mail.subject, 'Xác minh tài khoản VietPeaceStay');
    assert.match(mail.text, /https:\/\/example.com\/verify-email#token=/);
});
