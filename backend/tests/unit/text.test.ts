import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkAttachment, MAX_WORK_FILE_BYTES } from '../../src/services/chat.service.js';
import { extractMentions, snippet } from '../../src/services/notifications.service.js';

describe('extractMentions', () => {
  it('finds usernames after @', () => {
    assert.deepEqual(extractMentions('@priya please check, cc @a.sharma'), ['priya', 'a.sharma']);
  });

  it('ignores email addresses and trailing punctuation', () => {
    assert.deepEqual(extractMentions('mail sanjay@example.com'), []);
    assert.deepEqual(extractMentions('Thanks @priya.'), ['priya']);
  });

  it('is case-insensitive and unique', () => {
    assert.deepEqual(extractMentions('@Priya and @priya'), ['priya']);
  });

  it('skips names that are too short', () => {
    assert.deepEqual(extractMentions('@ab and @'), []);
  });
});

describe('snippet', () => {
  it('flattens whitespace and shortens long text', () => {
    assert.equal(snippet('a\n\n  b'), 'a b');
    assert.equal(snippet('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
  });
});

describe('checkAttachment', () => {
  const bytes = Buffer.from('hello');

  it('cleans file names and content types', () => {
    const f = checkAttachment('..\\bad/name?.pdf', 'Application/PDF', bytes);
    assert.equal(f.fileName, '.._bad_name_.pdf');
    assert.equal(f.contentType, 'application/pdf');
    assert.equal(checkAttachment('a.txt', 'not a type', bytes).contentType, 'application/octet-stream');
  });

  it('rejects empty, oversized and program files', () => {
    assert.throws(() => checkAttachment('a.txt', 'text/plain', Buffer.alloc(0)), /empty/);
    assert.throws(() => checkAttachment('setup.exe', 'application/octet-stream', bytes), /Program files/);
    assert.throws(() => checkAttachment('big.pdf', 'application/pdf', Buffer.alloc(11 * 1024 * 1024)), /10 MB/);
  });

  it('allows larger work files', () => {
    const f = checkAttachment('scan.pdf', 'application/pdf', Buffer.alloc(15 * 1024 * 1024), MAX_WORK_FILE_BYTES);
    assert.equal(f.content.length, 15 * 1024 * 1024);
  });
});
