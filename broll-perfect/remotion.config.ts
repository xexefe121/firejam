import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setOverwriteOutput(true);
// Keep Remotion's scratch space off C:, which is nearly full on this PC.
Config.setCachingEnabled(true);
// Port 3000 is the FireJam web dev server on this PC, so Remotion's studio and renderer both stay on 3111.
Config.setStudioPort(3111);
Config.setRendererPort(3111);
