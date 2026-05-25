export function formatPaper(paper: any) {
  return {
    title: paper.title,
    authors: paper.authors,
    abstract: paper.abstract ? paper.abstract.slice(0, 500) + (paper.abstract.length > 500 ? '...' : '') : null,
    source: paper.source,
    year: paper.year,
    url: paper.url,
    score: paper.similarity ? Number(paper.similarity.toFixed(4)) : null,
  };
}
