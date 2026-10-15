import type { DerivedLoop } from '../../contracts/engine';
import { BREAKDOWN_LABEL, PROBLEM_MARK, problemTone } from './labels';

export function ProblemTag({
  loop,
  item,
}: {
  loop: DerivedLoop;
  item: DerivedLoop['breakdowns'][number];
}) {
  const tone = problemTone(loop, item);
  return (
    <span className={`bd ${tone}`} title={item.sentence}>
      {PROBLEM_MARK[tone]} {BREAKDOWN_LABEL[item.type]}
    </span>
  );
}
