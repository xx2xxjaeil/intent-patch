import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TypeScriptPropertyTypeCompatibility } from "../../src/infrastructure/typescript/typescript-property-type-compatibility.js";

const compatibility = new TypeScriptPropertyTypeCompatibility();

describe("TypeScriptPropertyTypeCompatibility", () => {
  it("accepts a nested optional member added to a readonly object input", () => {
    assert.equal(
      compatibility.preservesOptionalObjectExtensions(
        "Readonly<{ requireFor?: readonly string[]; include?: readonly string[] }>",
        "Readonly<{ requireFor?: readonly string[]; include?: readonly string[]; related?: Readonly<Record<string, readonly string[]>> }>",
      ),
      true,
    );
  });

  it("rejects required additions and changes to existing members", () => {
    const previous = "Readonly<{ include?: readonly string[] }>";
    assert.equal(
      compatibility.preservesOptionalObjectExtensions(
        previous,
        "Readonly<{ include?: readonly string[]; related: string[] }>",
      ),
      false,
    );
    assert.equal(
      compatibility.preservesOptionalObjectExtensions(previous, "Readonly<{ include?: string[] }>"),
      false,
    );
    assert.equal(
      compatibility.preservesOptionalObjectExtensions(previous, "Readonly<{ related?: string[] }>"),
      false,
    );
  });

  it("does not claim compatibility for unsupported type transformations", () => {
    assert.equal(compatibility.preservesOptionalObjectExtensions("string", "number"), false);
    assert.equal(
      compatibility.preservesOptionalObjectExtensions(
        "Readonly<Record<string, string>>",
        "Readonly<Record<string, number>>",
      ),
      false,
    );
  });
});
