import {
  projectDiscourse,
  type DiscourseReconstruction,
  type SegmentReconstruction,
} from "@microsonya/discourse";

export function renderSummary(segments: SegmentReconstruction[]): string {
  const reconstruction: DiscourseReconstruction = {
    title: segments[0]?.reconstruction.title ?? "Підсумок",
    events: segments.flatMap((segment) => segment.reconstruction.events),
  };
  const { summary } = projectDiscourse(reconstruction);
  const claims = summary.topics.flatMap((topic) =>
    topic.claims.map((claim) => claim.text),
  );

  return [
    summary.title,
    "",
    ...formatSection(claims),
    ...(summary.decisions.length > 0
      ? ["", "Рішення:", ...summary.decisions.map((item) => item.text)]
      : []),
    ...(summary.openQuestions.length > 0
      ? [
          "",
          "Відкриті питання:",
          ...summary.openQuestions.map((item) => item.text),
        ]
      : []),
  ]
    .join("\n")
    .trim();
}

function formatSection(items: string[]): string[] {
  return items.length > 0
    ? items.map((item) => `• ${item}`)
    : ["• Немає даних."];
}
