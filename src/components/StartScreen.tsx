import { CONFIG } from '../sim/config';

interface Props {
  onStart(): void;
}

export function StartScreen({ onStart }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="start-title">
      <div className="panel">
        <p className="panel__eyebrow">感染広がりラボ</p>
        <h2 className="panel__title" id="start-title">
          街を守ってください
        </h2>
        <p className="panel__lead">
          点は街の人です。<span className="ink ink--danger">赤</span>が感染者、
          <span className="ink ink--safe">水色</span>が未感染、
          <span className="ink ink--recovered">紫</span>が回復した人です。
          近づいた時間が長いほど感染します。
        </p>

        <ol className="howto">
          <li>下のボタンで対策を選びます</li>
          <li>画面を押したまま動かすと、効果の範囲が見えます</li>
          <li>指を離すと、そこに対策を打ちます</li>
        </ol>

        <p className="panel__note">
          対策ポイントは {CONFIG.startPoints} から始まり、少しずつ回復します。
          全部は守りきれません。どこに使うかを選んでください。
        </p>

        <button type="button" className="cta" onClick={onStart} autoFocus>
          {CONFIG.duration} 秒で開始
        </button>
      </div>
    </div>
  );
}
