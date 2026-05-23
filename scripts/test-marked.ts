import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal() as any);

async function run() {
  const md = `### Header Test\nThis is **bold** text.`;
  const result = await marked.parse(md);
  console.log("Raw output:");
  console.log(JSON.stringify(result));
  console.log("Printed output:");
  console.log(result);
}
run();
