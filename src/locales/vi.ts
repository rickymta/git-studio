// Vietnamese dictionary, split by area so files stay readable.
import { core } from './vi/core';
import { diff } from './vi/diff';
import { history } from './vi/history';
import { integrations } from './vi/integrations';
import { home } from './vi/home';
import { panels } from './vi/panels';
import { prefs } from './vi/prefs';

export const vi: Record<string, string> = {
  ...core,
  ...panels,
  ...prefs,
  ...home,
  ...diff,
  ...history,
  ...integrations,
};
