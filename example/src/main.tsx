import { render } from 'preact';
import { install } from 'preact-perf-tracker';
import { App } from './App';

install({
  enabled: true,
  showToolbar: true,
  log: true,
  animationSpeed: 'fast',
});

render(<App />, document.getElementById('app')!);
