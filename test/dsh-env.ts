import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hireseek-dsh-'));
process.env.HIRESEEK_DB_PATH = path.join(tmp, 'hireseek-test.db');
process.env.HIRECLAW_DB_PATH = process.env.HIRESEEK_DB_PATH;
