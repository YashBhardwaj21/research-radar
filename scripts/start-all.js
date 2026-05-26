const { spawn } = require('child_process');

// Start the API and the background workers in parallel for testing environments
console.log('Starting API and Background Workers...');

spawn('npm', ['run', 'api'], { stdio: 'inherit', shell: true });
spawn('npm', ['run', 'worker'], { stdio: 'inherit', shell: true });
spawn('npm', ['run', 'embedding-worker'], { stdio: 'inherit', shell: true });
