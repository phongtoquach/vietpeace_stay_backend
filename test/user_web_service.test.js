const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sql = require('mssql');
const bcrypt = require('bcryptjs');

function load(file, dependencies) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        module, Buffer,
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    });
    return module.exports;
}
const body = { email: ' Person@Example.com ', password: 'test-password-123', full_name: 'Test Person', display_name: 'Test', role: 'ADMIN' };
const message = 'Địa chỉ Email này đã được sử dụng! Vui lòng nhập email khác!';
function setup(query) {
    const pool = { request() {
        const inputs = {};
        return {
            input(name, type, value) { inputs[name] = value; return this; },
            query(text) { return query(text, inputs); }
        };
    } };
    const service = load('services/user_web_service.js', {
        mssql: sql, bcryptjs: bcrypt, '../configs/database': { getDBPool: () => pool }
    });
    const controller = load('controllers/web/auth/authController.js', {
        '../../../services/auth_service': {},
        '../../../services/user_web_service': service
    });
    return { service, async request(input = body) {
        const res = { status(code) { this.code = code; return this; }, json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; } };
        await controller.register({ body: input }, res);
        return res;
    } };
}
for (const role of ['CUSTOMER', 'ADMIN']) {
    test(`duplicate ${role}: normalize email, exact 409, no writes`, async () => {
        const app = setup(async (text, inputs) => {
            assert.match(text, /WHERE email = @email/);
            assert.doesNotMatch(text, /role|status|INSERT|UPDATE/i);
            assert.equal(inputs.email, 'person@example.com');
            return { recordset: [{ id: 'existing', role }] };
        });
        const res = await app.request();
        assert.equal(res.code, 409);
        assert.deepEqual(res.body, { success: false, message });
    });
}
test('new account: bcrypt 12, backend CUSTOMER/status 0, safe 201', async () => {
    const app = setup(async (text, inputs) => {
        if (!text.includes('INSERT')) return { recordset: [] };
        assert.match(text, /'CUSTOMER',\s*0/);
        assert.equal(inputs.role, undefined);
        assert.equal(inputs.email, 'person@example.com');
        assert.equal(bcrypt.getRounds(inputs.password_hash), 12);
        assert.ok(await bcrypt.compare(body.password, inputs.password_hash));
        return { recordset: [{ id: 'new', email: inputs.email, full_name: body.full_name, password_hash: inputs.password_hash }] };
    });
    const res = await app.request();
    assert.equal(res.code, 201);
    assert.deepEqual(res.body, { success: true, message: 'Đăng ký thành công', customer: { id: 'new', name: body.full_name, email: 'person@example.com' } });
});
for (const number of [2601, 2627]) {
    test(`concurrent inserts: simulated email UNIQUE ${number}`, async () => {
        let inserted = false;
        const app = setup(async (text, inputs) => {
            if (!text.includes('INSERT')) return { recordset: [] };
            if (inserted) throw { number, message: number === 2627
                ? "Violation of UNIQUE KEY constraint 'UQ__users__AB6E6164E77901F7'. Cannot insert duplicate key in object 'dbo.users'."
                : "Cannot insert duplicate key row in object 'dbo.users' with unique index 'UQ__users__AB6E6164E77901F7'." };
            inserted = true;
            return { recordset: [{ id: 'new', email: inputs.email, full_name: 'Test' }] };
        });
        const results = await Promise.all([app.request(), app.request()]);
        assert.deepEqual(results.map(res => res.code).sort(), [201, 409]);
        assert.deepEqual(results.find(res => res.code === 409).body, { success: false, message });
    });
}
for (const number of [2601, 2627, 1205]) {
    test(`unrelated SQL error ${number}: safe 500`, async () => {
        const app = setup(async text => {
            if (text.includes('INSERT')) throw { number, message: 'Other constraint or private database details' };
            return { recordset: [] };
        });
        const res = await app.request();
        assert.equal(res.code, 500);
        assert.deepEqual(res.body, { success: false, message: 'Không thể đăng ký lúc này. Vui lòng thử lại sau.' });
    });
}
test('invalid email: 400 before database access', async () => {
    const app = setup(() => assert.fail('Unexpected DB access'));
    assert.equal((await app.request({ ...body, email: 'invalid' })).code, 400);
});
test('legacy auth register delegates to Web service', () => {
    const register = () => {};
    const auth = load('services/auth_service.js', {
        mssql: sql, bcryptjs: bcrypt, '../configs/database': {}, './user_web_service': { register }
    });
    assert.equal(auth.register, register);
});
