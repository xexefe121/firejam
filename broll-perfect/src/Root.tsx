import React from 'react';
import { Composition, Folder } from 'remotion';
import editJson from '../manifest/edit.json';
import brollJson from '../manifest/broll.json';
import captionsJson from '../manifest/captions-final.json';
import type { BrollManifest, CaptionItem, DemoProps, EditManifest } from './types';
import { FireJamDemo, calculateDemoMetadata } from './FireJamDemo';
import { HookScene } from './scenes/Hook';
import { SplitScene } from './scenes/Split';
import { PhoneScene } from './scenes/Phone';
import { AwsScene } from './scenes/Aws';
import { TitleScene } from './scenes/Title';
import { EndScene } from './scenes/End';
import { sampleAws, sampleEnd, sampleHook, samplePhone, sampleSplit, sampleTitle } from './sample';
import { totalFrames } from './timeline';

const edit = editJson as unknown as EditManifest;
const broll = brollJson as unknown as BrollManifest;
const captions = captionsJson as unknown as CaptionItem[];

const defaultProps: DemoProps = { edit, broll, captions };

const W = 1920;
const H = 1080;
const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FireJamDemo"
        component={FireJamDemo}
        durationInFrames={totalFrames(edit)}
        fps={edit.fps || FPS}
        width={edit.width || W}
        height={edit.height || H}
        defaultProps={defaultProps}
        calculateMetadata={calculateDemoMetadata}
      />
      <Folder name="Previews">
        <Composition
          id="HookCard"
          component={HookScene}
          durationInFrames={sampleHook.dur * FPS}
          fps={FPS}
          width={W}
          height={H}
          defaultProps={{ segment: sampleHook }}
        />
        <Composition
          id="SplitSync"
          component={SplitScene}
          durationInFrames={sampleSplit.dur * FPS}
          fps={FPS}
          width={W}
          height={H}
          defaultProps={{ segment: sampleSplit }}
        />
        <Composition
          id="PhoneRemote"
          component={PhoneScene}
          durationInFrames={samplePhone.dur * FPS}
          fps={FPS}
          width={W}
          height={H}
          defaultProps={{ segment: samplePhone }}
        />
        <Composition
          id="AwsBeat"
          component={AwsScene}
          durationInFrames={sampleAws.dur * FPS}
          fps={FPS}
          width={W}
          height={H}
          defaultProps={{ segment: sampleAws }}
        />
        <Composition
          id="TitleCard"
          component={TitleScene}
          durationInFrames={sampleTitle.dur * FPS}
          fps={FPS}
          width={W}
          height={H}
          defaultProps={{ segment: sampleTitle }}
        />
        <Composition
          id="EndCard"
          component={EndScene}
          durationInFrames={sampleEnd.dur * FPS}
          fps={FPS}
          width={W}
          height={H}
          defaultProps={{ segment: sampleEnd }}
        />
      </Folder>
    </>
  );
};
