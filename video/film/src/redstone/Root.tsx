import React from 'react';
import { Composition } from 'remotion';
import { END, Film } from './Film';

export const Root: React.FC = () => <Composition id="Redstone" component={Film} durationInFrames={END} fps={30} width={1920} height={1080} />;
