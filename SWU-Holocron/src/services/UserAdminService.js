import { getFunctions, httpsCallable } from 'firebase/functions';
import { isConfigured } from '../firebase';

/**
 * Admin user management: thin wrappers over the adminListUsers /
 * adminGetUserDetail / adminSetRole callables. Never throws.
 *
 * @environment:firebase
 */
function message(err) {
  switch (err?.code) {
    case 'functions/permission-denied': return 'Admins only.';
    case 'functions/not-found':
    case 'functions/internal': return "User management isn't deployed yet, or that user no longer exists.";
    case 'functions/failed-precondition':
    case 'functions/invalid-argument': return err.message;
    default: return "Couldn't reach the server. Try again.";
  }
}

async function call(name, data) {
  if (!isConfigured) return { error: 'Not connected to the server.' };
  try {
    const res = await httpsCallable(getFunctions(), name)(data);
    return res.data;
  } catch (err) {
    return { error: message(err) };
  }
}

export const UserAdminService = {
  listUsers: ({ includeGuests = false } = {}) => call('adminListUsers', { includeGuests }),
  getUserDetail: (uid) => call('adminGetUserDetail', { uid }),
  setRole: (uid, role, value) => call('adminSetRole', { uid, role, value }),
};
