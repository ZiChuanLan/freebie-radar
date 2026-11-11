const res = await fetch("https://api.github.com/repos/ripienaar/free-for-dev/contents/README.md", { headers: { accept: "application/vnd.github.raw" } });
const md = await res.text();
const heads = [...md.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim());
console.log("sections:", heads.length);
console.log([...new Set(heads)].slice(0, 40).join("\n"));
