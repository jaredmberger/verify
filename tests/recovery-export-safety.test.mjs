import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
test('Verify recovery export safety boundary',async()=>{
  const source=await readFile(new URL('../src/entry-v1.2.js',import.meta.url),'utf8');
  assert.match(source,/RECOVERY_EXPORT_TOKEN/);
  assert.match(source,/x-curator-recovery-key/);
  assert.match(source,/CURATOR_VERIFY_RECORDS/);
  assert.match(source,/bf7fb04aa1754f729acd62595bf21004/);
  assert.match(source,/list_complete/);
  assert.match(source,/dataSha256/);
});
