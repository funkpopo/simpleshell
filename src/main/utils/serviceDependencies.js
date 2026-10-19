/**
 * A domain service receives a named interface to its owner's state and commands.
 * Method forwarding stays live so command overrides and session replacement use
 * the current owner. Function-valued state (for example event listeners) keeps
 * its exact identity for add/removeListener pairs.
 */
function serviceDependencies(owner, { methods = [], fields = [] }) {
  const dependencies = {};
  for (const name of methods) {
    dependencies[name] = (...args) => owner[name](...args);
  }
  for (const name of fields) {
    Object.defineProperty(dependencies, name, {
      enumerable: true,
      get: () => owner[name],
      set: (value) => {
        owner[name] = value;
      },
    });
  }
  return dependencies;
}

module.exports = serviceDependencies;
