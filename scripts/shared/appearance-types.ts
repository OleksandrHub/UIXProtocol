// Per-user appearance preferences blob. Free-form on purpose: the front-end
// owns its own shape (fonts, colours, panel toggles) and the server only
// stores opaque JSON. The widening to `unknown` lets the client evolve the
// shape without server-side migrations.
export type Appearance = Record<string, unknown>;
