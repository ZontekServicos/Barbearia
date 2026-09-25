import {it} from "node:test"
import assert from "node:assert/strict"
import {randomUUID} from "node:crypto"
import {readFileSync,readdirSync} from "node:fs"
import {createRequire} from "node:module"
import {isOverlapViolation} from "../modules/booking/booking-conflict.js"
const database=process.env.TEST_DATABASE_URL
if(database){const u=new URL(database);if(!["127.0.0.1","localhost","[::1]"].includes(u.hostname)||u.pathname!=="/erickcorttes_test")throw new Error("Only isolated localhost erickcorttes_test allowed")}
it("public migration preserves historical ranges, replaces exclusion atomically, and translates native deadlock",{skip:!database},async()=>{
 const {Client}=createRequire(import.meta.resolve("@prisma/adapter-pg"))("pg")
 const db=new Client({connectionString:database}), other=new Client({connectionString:database})
 const schema="public_upgrade_"+randomUUID().replaceAll("-","")
 await db.connect();await other.connect()
 try{
  await db.query(`CREATE SCHEMA "${schema}"`)
  for(const c of [db,other])await c.query(`SET search_path TO "${schema}"`)
  const root="prisma/migrations", target="20260925100000_public_booking_requests"
  for(const folder of readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name<target).map(d=>d.name).sort())await db.query(readFileSync(`${root}/${folder}/migration.sql`,"utf8"))
  const user=randomUUID(),service=randomUUID(),id=randomUUID()
  await db.query("INSERT INTO users(id,phone,updated_at) VALUES($1,'+5571999912312',now())",[user])
  await db.query("INSERT INTO services(id,name,price_cents,duration_minutes,updated_at) VALUES($1,'Legacy',1000,30,now())",[service])
  await db.query("INSERT INTO appointments(id,user_id,service_id,starts_at,ends_at,service_name,service_price_cents,updated_at) VALUES($1,$2,$3,'2026-10-01T12:00:00Z','2026-10-01T12:30:00Z','Original',1000,now())",[id,user,service])
  const before=(await db.query("SELECT * FROM appointments")).rows[0]
  const sql=readFileSync(`${root}/${target}/migration.sql`,"utf8")
  // A reader holds its table lock. The DDL must fail atomically on timeout.
  await other.query("BEGIN");await other.query("SELECT * FROM appointments")
  await db.query("SET lock_timeout='300ms'")
  await assert.rejects(db.query(sql),{code:"55P03"});await db.query("ROLLBACK")
  assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='appointments' AND column_name='reserved_ends_at'",[schema])).rowCount,0)
  await other.query("ROLLBACK");await db.query("SET lock_timeout='5s'")
  const start=performance.now();await db.query(sql);console.log("Public migration on synthetic fixture ms:",Math.round(performance.now()-start))
  const {reserved_ends_at,public_token,pending_expires_at,decided_at,...unchanged}=(await db.query("SELECT * FROM appointments WHERE id=$1",[id])).rows[0]
  assert.deepEqual(unchanged,before);assert.deepEqual(reserved_ends_at,before.ends_at);assert.equal(public_token,null);assert.equal(pending_expires_at,null);assert.equal(decided_at,null)
  const constraint=(await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='appointments'::regclass AND conname='appointments_no_overlap'")).rows
  assert.equal(constraint.length,1);assert.match(constraint[0].definition,/reserved_ends_at/);assert.match(constraint[0].definition,/PENDING/)
  const insert=(status:string,starts:string,ends:string,reserved:string)=>db.query("INSERT INTO appointments(id,user_id,service_id,starts_at,ends_at,reserved_ends_at,status,service_name,service_price_cents,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::\"AppointmentStatus\",'Test',1000,now()) RETURNING id",[randomUUID(),user,service,starts,ends,reserved,status])
  await db.query("UPDATE appointments SET reserved_ends_at='2026-10-01T12:40:00Z' WHERE id=$1",[id])
  for(const status of ["PENDING","CONFIRMED"])await assert.rejects(insert(status,"2026-10-01T12:30:00Z","2026-10-01T12:35:00Z","2026-10-01T12:45:00Z"),{code:"23P01"})
  for(const status of ["REJECTED","EXPIRED","CANCELLED","COMPLETED","NO_SHOW"])await insert(status,"2026-10-01T12:05:00Z","2026-10-01T12:15:00Z","2026-10-01T12:40:00Z")
  await insert("PENDING","2026-10-01T12:40:00Z","2026-10-01T13:10:00Z","2026-10-01T13:20:00Z")
  await assert.rejects(insert("CONFIRMED","2026-10-01T14:00:00Z","2026-10-01T14:30:00Z","2026-10-01T14:20:00Z"),{code:"23514"})
  await assert.rejects(db.query("UPDATE services SET buffer_after_minutes=1 WHERE id=$1",[service]),{code:"23514"})
  await db.query("UPDATE appointments SET public_token=$1 WHERE id=$2",["f".repeat(64),id])
  await assert.rejects(db.query("UPDATE appointments SET public_token=$1 WHERE id<>$2",["f".repeat(64),id]),{code:"23505"})
  // Exercise a real 40P01, not only a fabricated error code.
  await db.query("CREATE TABLE deadlock_probe(id integer primary key, value integer); INSERT INTO deadlock_probe VALUES(1,0),(2,0)")
  await db.query("BEGIN");await other.query("BEGIN")
  await db.query("UPDATE deadlock_probe SET value=1 WHERE id=1");await other.query("UPDATE deadlock_probe SET value=1 WHERE id=2")
  const mutate=async(c:any,id:number)=>{try{await c.query("UPDATE deadlock_probe SET value=2 WHERE id=$1",[id]);await c.query("COMMIT");return null}catch(e){await c.query("ROLLBACK");return e}}
  const results=await Promise.all([mutate(db,2),mutate(other,1)])
  const errors=results.filter(Boolean) as Array<{code:string}>
  assert.equal(errors.length,1);assert.equal(errors[0]!.code,"40P01");assert.ok(isOverlapViolation(errors[0]))
 }finally{
  await other.query("ROLLBACK");await db.query("ROLLBACK")
  await other.end();await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await db.end()
 }
})
