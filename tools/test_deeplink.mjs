import nacl from 'tweetnacl';
import bs58 from 'bs58';
// our dapp keypair (what connectPhantomMobile generates + stores)
const dapp = nacl.box.keyPair();
// --- simulate Phantom's CONNECT response ---
const phantom = nacl.box.keyPair();
const sharedPhantom = nacl.box.before(dapp.publicKey, phantom.secretKey);
const connectPayload = new TextEncoder().encode(JSON.stringify({ public_key: 'Wa11etPubKeyABCDEF1234567890', session: 'sess-token-xyz' }));
const cNonce = nacl.randomBytes(24);
const cData = nacl.box.after(connectPayload, cNonce, sharedPhantom);
// --- our connect-redirect handler derives the shared secret + decrypts ---
const sharedDapp = nacl.box.before(phantom.publicKey, dapp.secretKey);
const cDec = nacl.box.open.after(bs58.decode(bs58.encode(cData)), bs58.decode(bs58.encode(cNonce)), sharedDapp);
const info = JSON.parse(new TextDecoder().decode(cDec));
console.log('connect decrypt:', JSON.stringify(info));
// --- simulate the SIGN response round-trip using the shared secret ---
const sig = nacl.randomBytes(64);
const sNonce = nacl.randomBytes(24);
const sData = nacl.box.after(new TextEncoder().encode(JSON.stringify({ signature: bs58.encode(sig) })), sNonce, sharedPhantom);
const sDec = nacl.box.open.after(sData, sNonce, sharedDapp);
const signOut = JSON.parse(new TextDecoder().decode(sDec));
console.log('sign decrypt has signature:', !!signOut.signature, '(len', signOut.signature.length, ')');
console.log('SHARED SECRETS MATCH:', bs58.encode(sharedDapp) === bs58.encode(sharedPhantom));
