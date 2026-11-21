// Public join page: request to join, invite sign-up and registration status (P0).

import { createApp, currentRoute } from '../core/app.js';
import { bpJoinStart, bpRequestForm, bpRequestSent, joinStartActions } from '../components/bpJoinStart.js';
import { bpInviteSignup, signupActions } from '../components/bpInviteSignup.js';
import { bpRegistrationStatus } from '../components/bpRegistrationStatus.js';

function render() {
  const { name, params } = currentRoute('');
  switch (name) {
    case 'request':
      return params[0] === 'sent' ? bpRequestSent(params[1]) : bpRequestForm();
    case 'invite':
      return bpInviteSignup(params[0]);
    case 'status':
      return bpRegistrationStatus(params[0]);
    default:
      return bpJoinStart();
  }
}

createApp({ mount: 'app', render, actions: { ...joinStartActions, ...signupActions } });
