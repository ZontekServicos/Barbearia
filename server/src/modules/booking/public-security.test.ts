import {it} from "node:test"
import assert from "node:assert/strict"
import {isOverlapViolation} from "./booking-conflict.js"
import {generatePublicToken,digestPublicToken} from "./public-token.js"
it("native and wrapped PostgreSQL conflicts translate without exposing exception details",()=>{
 for(const e of [{code:"23P01"},{code:"40P01"},{code:"P2034"},{code:"P2010",meta:{code:"40P01"}},{cause:{code:"23P01"}}])assert.ok(isOverlapViolation(e))
 for(const e of [null,{code:"ECONNREFUSED"},{code:"P2025"},new Error("database unavailable")])assert.equal(isOverlapViolation(e),false)
})
it("public tokens contain 32 random bytes and only their unique SHA256 digests persist",()=>{
 const tokens=Array.from({length:200},generatePublicToken)
 assert.equal(new Set(tokens).size,200)
 for(const t of tokens){assert.match(t,/^[A-Za-z0-9_-]{43}$/);assert.equal(Buffer.from(t,"base64url").length,32);assert.match(digestPublicToken(t),/^[a-f0-9]{64}$/);assert.notEqual(digestPublicToken(t),t)}
})
