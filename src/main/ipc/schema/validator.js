let ajvInstance = null;
function getAjv() {
  if (!ajvInstance) {
    const Ajv = require("ajv");
    const addFormats = require("ajv-formats");
    ajvInstance = new Ajv({
      allErrors: true,
      strict: false,
    });
    addFormats(ajvInstance);
  }
  return ajvInstance;
}

const compiledSchemas = new WeakMap();

function compileSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return null;
  }

  if (!compiledSchemas.has(schema)) {
    compiledSchemas.set(schema, getAjv().compile(schema));
  }

  return compiledSchemas.get(schema);
}

function formatValidationErrors(validate) {
  if (!validate || !Array.isArray(validate.errors)) {
    return "schema validation failed";
  }

  return getAjv().errorsText(validate.errors, {
    dataVar: "payload",
    separator: "; ",
  });
}

function validateSchema(schema, value) {
  const validate = compileSchema(schema);
  if (!validate) {
    return { valid: true, error: null };
  }

  const valid = validate(value);
  return {
    valid,
    error: valid ? null : formatValidationErrors(validate),
  };
}

module.exports = {
  validateSchema,
};
