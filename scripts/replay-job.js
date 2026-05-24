const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const jobId = process.argv[2];

if (!jobId) {
  console.error('Usage: npm run replay-job <JOB_ID>');
  process.exit(1);
}

const tracePath = path.resolve(__dirname, '..', 'traces', `trace-${jobId}.zip`);

if (!fs.existsSync(tracePath)) {
  console.error(`Trace file not found: ${tracePath}`);
  console.error('Make sure the job actually failed and generated a trace.');
  process.exit(1);
}

console.log(`Opening Playwright trace viewer for job ${jobId}...`);
try {
  execSync(`npx playwright show-trace "${tracePath}"`, { stdio: 'inherit' });
} catch (err) {
  console.error('Failed to open trace viewer.', err.message);
  process.exit(1);
}
