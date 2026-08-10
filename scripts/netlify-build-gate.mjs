const approved = process.env.NETLIFY_RELEASE_APPROVED === "true";

if (approved) {
  console.log("Netlify release approved: continuing the build.");
  process.exitCode = 1;
} else {
  console.log("Netlify release paused: set NETLIFY_RELEASE_APPROVED=true only after hospital approval.");
  process.exitCode = 0;
}
