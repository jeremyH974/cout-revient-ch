import { beforeEach, describe, expect, it } from 'vitest';
import {
  mailboxPassphrase,
  resetMailboxSessionForTests,
  setMailboxPassphrase,
} from './mailbox-session';

describe('mailbox-session', () => {
  beforeEach(() => resetMailboxSessionForTests());

  it('rien tant que personne n’a rien saisi', () => {
    expect(mailboxPassphrase()).toBeNull();
  });

  it('mémorise la phrase saisie, exactement telle quelle', () => {
    setMailboxPassphrase('correct horse battery staple');
    expect(mailboxPassphrase()).toBe('correct horse battery staple');
  });

  it('null efface la phrase', () => {
    setMailboxPassphrase('quelque chose');
    setMailboxPassphrase(null);
    expect(mailboxPassphrase()).toBeNull();
  });
});
