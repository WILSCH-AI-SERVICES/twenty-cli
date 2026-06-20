setInterval(() => {}, 1_000);

process.stdout.write("fixture-stdout\n", () => {
  process.stderr.write("fixture-stderr\n");
});
