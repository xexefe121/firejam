import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
// Keep Remotion's scratch space off C:, which is nearly full on this PC.
Config.setCachingEnabled(true);
// Port 3000 is the FireJam web dev server on this PC (Remotion's free-port check misses it), so the
// studio uses 3111 and `npm run render` passes --port=3123.
Config.setStudioPort(3111);
