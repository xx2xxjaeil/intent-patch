import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TypeScriptFunctionSignatureCompatibility } from "../../src/infrastructure/typescript/typescript-function-signature-compatibility.js";

const compatibility = new TypeScriptFunctionSignatureCompatibility();

describe("TypeScriptFunctionSignatureCompatibility", () => {
  it("accepts a required parameter made optional and a wider returned function", () => {
    assert.equal(
      compatibility.preservesPreviousCalls(
        ["(string,number):()=>string"],
        ["(string,number?):(size?: number)=>string"],
      ),
      true,
    );
  });

  it("accepts an added optional argument and retained overload", () => {
    assert.equal(
      compatibility.preservesPreviousCalls(["(string):string"], ["(string,number?):string"]),
      true,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(
        ["(string):string", "(number):number"],
        ["(string):string", "(number):number", "(boolean):boolean"],
      ),
      true,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(["(string):string"], ["(string | number):string"]),
      true,
    );
  });

  it("rejects reordered, narrowed, or removed call signatures", () => {
    assert.equal(
      compatibility.preservesPreviousCalls(["(string,number?):string"], ["(number,string):string"]),
      false,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(["(string):string"], ["(number):string"]),
      false,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(["(string | number):string"], ["(string):string"]),
      false,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(
        ["(string):string", "(number):number"],
        ["(string):string"],
      ),
      false,
    );
  });

  it("handles a nested callback type without splitting its comma", () => {
    assert.equal(
      compatibility.preservesPreviousCalls(
        ["((value: string, index: number) => void):void"],
        ["((value: string, index: number) => void,boolean?):void"],
      ),
      true,
    );
  });

  it("leaves unknown or malformed types unverified", () => {
    assert.equal(
      compatibility.preservesPreviousCalls(["(User):User"], ["(User,number?):User"]),
      undefined,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(["(string):inferred"], ["(string):string"]),
      undefined,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(["not a signature"], ["(string):string"]),
      undefined,
    );
    assert.equal(
      compatibility.preservesPreviousCalls(["('a  b'):string"], ["('a b'):string"]),
      undefined,
    );
  });
});
