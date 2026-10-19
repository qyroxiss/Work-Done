/** Console helpers shared by the command-line scripts. */
import readline from 'node:readline';
import { Writable } from 'node:stream';

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let muted = false;
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
let rl: readline.Interface | null = null;

export function ask(question: string, hidden = false): Promise<string> {
  rl ??= readline.createInterface({ input: process.stdin, output, terminal: true });
  const iface = rl;
  return new Promise((resolve) => {
    process.stdout.write(question);
    muted = hidden;
    iface.question('', (answer) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/** Password from the ADMIN_PASSWORD environment variable, or asked twice on the console. */
export async function askNewPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD ?? '';
  if (fromEnv) return fromEnv;
  const password = await ask('Password (min 8 chars, letters + numbers): ', true);
  const confirm = await ask('Confirm password: ', true);
  if (password !== confirm) throw new Error('Passwords do not match.');
  return password;
}

export function closePrompt() {
  rl?.close();
  rl = null;
}
