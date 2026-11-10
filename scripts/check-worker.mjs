import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--config','publisher/wrangler.toml','--outdir','../worker-dist'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
process.exit(result.status??1);
