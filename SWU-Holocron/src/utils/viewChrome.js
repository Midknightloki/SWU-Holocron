/**
 * Which header controls a view shows. The set picker only means something on
 * the views that show one set: the binder and the Command Center (dashboard).
 */
const SET_VIEWS = new Set(['binder', 'dashboard']);

export const showsSetPicker = (view) => SET_VIEWS.has(view);
