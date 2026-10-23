/** test-direct-s3.mjs — GET langsung dari bucket (tanpa presign) */
const period = "fd68e454-ba45-4b85-8205-f3bf777ded24";
const id = process.argv[2] || "ae1d3950-7e65-4326-b7bb-af7c97c4b987";
const fname = process.argv[3];
const url = `https://sisnas-fasih-assignment.obj.bps.go.id/${period}_data/${id}/${fname}`;
console.log("GET", new URL(url).pathname.slice(0, 90));
const res = await fetch(url);
const buf = Buffer.from(await res.arrayBuffer());
console.log("status:", res.status, "ct:", res.headers.get("content-type"), "bytes:", buf.length);
console.log("magic:", buf.subarray(0, 4).toString("hex"), buf.subarray(0, 2).toString());
process.exit(0);
