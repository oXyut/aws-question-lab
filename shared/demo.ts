import type { Architecture, Evaluation, ExplanationDocument, QuestionDraft } from './schema.js';

/** Original fictional exercise, supplied for trying the UI without an AI request. */
export const demoQuestion: QuestionDraft = {
  title: 'サンプル：S3 のログを、必要なときだけ SQL で分析する',
  text: 'あるチームは、アプリケーションのログを Amazon S3 に Parquet 形式で保存しています。分析担当者は、月に数回、不定期に SQL を使ってログを集計します。分析のために元データを別のデータストアへコピーしてはなりません。チームには既存のデータウェアハウスがなく、運用負荷を最小限にしたいと考えています。最も適切な構成を 1 つ選んでください。',
  options: [
    {
      id: 'a',
      label: 'A',
      text: 'AWS Glue Data Catalog にテーブルを定義し、Amazon Athena で S3 のログをクエリする。',
    },
    {
      id: 'b',
      label: 'B',
      text: 'プロビジョンド型の Amazon Redshift RA3 クラスターを新規作成し、Redshift Spectrum で S3 のログをクエリする。',
    },
    {
      id: 'c',
      label: 'C',
      text: '常時稼働する Amazon EMR on EC2 クラスターを作成し、Spark SQL で S3 のログをクエリする。',
    },
  ],
  selectionMode: 'single',
  selectionCount: 1,
  knownAnswerIds: ['a'],
  originalExplanation:
    'アプリの操作を試すために作成した架空の練習問題です。公式試験問題ではありません。',
  uncertainties: [],
  imageIds: [],
};

const requirements = [
  {
    id: 'sql',
    label: '不定期の SQL 分析',
    quote: '月に数回、不定期に SQL を使ってログを集計',
    quoteOccurrence: 0,
    kind: 'hard' as const,
    explanation:
      'SQL による集計ができることを確認します。不定期という利用頻度も構成選定の背景です。',
  },
  {
    id: 'inplace',
    label: '元データをコピーしない',
    quote: '元データを別のデータストアへコピーしてはなりません',
    quoteOccurrence: 0,
    kind: 'hard' as const,
    explanation:
      '分析の入力を S3 に置いたまま読めることが必須です。クエリ結果の保存まで禁止する条件ではありません。',
  },
  {
    id: 'operations',
    label: '運用負荷を最小限に',
    quote: '運用負荷を最小限',
    quoteOccurrence: 0,
    kind: 'preference' as const,
    explanation:
      '機能上は成立する構成を比べ、追加のクラスター管理が少ないものを選びます。実現不可能という意味での除外とは区別します。',
  },
];

const athena: Architecture = {
  id: 'graph-a',
  title: 'A · Athena で直接分析',
  optionIds: ['a'],
  description: 'S3 のデータとテーブル定義を分け、必要なときに SQL を実行します。',
  nodes: [
    {
      id: 'a-analyst',
      service: null,
      label: '分析担当者',
      description: '必要なときに SQL を実行します。',
      requirementIds: ['sql'],
    },
    {
      id: 'a-athena',
      service: 'athena',
      label: 'Amazon Athena',
      description: 'サーバーやクラスターを用意せずに SQL を実行します。',
      requirementIds: ['sql', 'operations'],
    },
    {
      id: 'a-s3',
      service: 's3',
      label: 'Amazon S3',
      description: 'Parquet の元データを保持します。',
      requirementIds: ['inplace'],
    },
    {
      id: 'a-catalog',
      service: 'catalog',
      label: 'Glue Data Catalog',
      description: '列、型、S3 の場所などのテーブル定義を管理します。データ本体は保存しません。',
      requirementIds: ['inplace', 'operations'],
    },
  ],
  edges: [
    {
      id: 'a-query',
      from: 'a-analyst',
      to: 'a-athena',
      label: 'SQL を実行',
      kind: 'control',
      requirementIds: ['sql'],
    },
    {
      id: 'a-read',
      from: 'a-s3',
      to: 'a-athena',
      label: 'データを直接読み取る',
      kind: 'data',
      requirementIds: ['inplace'],
    },
    {
      id: 'a-schema',
      from: 'a-catalog',
      to: 'a-athena',
      label: 'テーブル定義',
      kind: 'metadata',
      requirementIds: ['inplace'],
    },
  ],
  steps: [
    {
      title: 'テーブルを定義する',
      description: 'Data Catalog に S3 の場所と列の型を登録します。元データの移動はありません。',
      nodeIds: ['a-catalog', 'a-s3'],
      edgeIds: [],
    },
    {
      title: '必要なときに SQL を送る',
      description: '分析担当者が Athena に SQL を送信します。',
      nodeIds: ['a-analyst', 'a-athena'],
      edgeIds: ['a-query'],
    },
    {
      title: 'S3 を読み取って集計する',
      description: 'Athena はテーブル定義を参照し、S3 のデータを読み取ります。',
      nodeIds: ['a-athena', 'a-s3', 'a-catalog'],
      edgeIds: ['a-read', 'a-schema'],
    },
  ],
};

function alternative(
  id: 'b' | 'c',
  title: string,
  service: string,
  label: string,
  description: string,
): Architecture {
  return {
    id: `graph-${id}`,
    title,
    optionIds: [id],
    description,
    nodes: [
      {
        id: `${id}-analyst`,
        service: null,
        label: '分析担当者',
        description: 'SQL クエリを送ります。',
        requirementIds: ['sql'],
      },
      { id: `${id}-engine`, service, label, description, requirementIds: ['sql', 'operations'] },
      {
        id: `${id}-s3`,
        service: 's3',
        label: 'Amazon S3',
        description: '元データは S3 に残します。',
        requirementIds: ['inplace'],
      },
      {
        id: `${id}-ops`,
        service: null,
        label: 'クラスターの管理',
        description: '容量・構成や稼働の管理が選択肢に含まれます。',
        requirementIds: ['operations'],
      },
    ],
    edges: [
      {
        id: `${id}-query`,
        from: `${id}-analyst`,
        to: `${id}-engine`,
        label: 'SQL を実行',
        kind: 'control',
        requirementIds: ['sql'],
      },
      {
        id: `${id}-read`,
        from: `${id}-s3`,
        to: `${id}-engine`,
        label: 'S3 を読み取る',
        kind: 'data',
        requirementIds: ['inplace'],
      },
      {
        id: `${id}-manage`,
        from: `${id}-ops`,
        to: `${id}-engine`,
        label: '運用・構成管理',
        kind: 'control',
        requirementIds: ['operations'],
      },
    ],
    steps: [
      {
        title: 'クラスターを用意する',
        description: 'この選択肢では新しいクラスターの構成と稼働を管理します。',
        nodeIds: [`${id}-engine`, `${id}-ops`],
        edgeIds: [`${id}-manage`],
      },
      {
        title: 'SQL で S3 を分析する',
        description: 'S3 の元データを読み取り、SQL で集計できます。',
        nodeIds: [`${id}-analyst`, `${id}-engine`, `${id}-s3`],
        edgeIds: [`${id}-query`, `${id}-read`],
      },
    ],
  };
}

function evaluation(
  optionId: 'a' | 'b' | 'c',
  summary: string,
  conditionsToBeCorrect: string,
): Evaluation {
  const sourceId =
    optionId === 'a' ? 'source-athena' : optionId === 'b' ? 'source-redshift' : 'source-emr';
  return {
    optionId,
    overall: optionId === 'a' ? 'meets' : 'inferior',
    summary,
    conditionsToBeCorrect,
    architectureId: `graph-${optionId}`,
    checks: [
      {
        requirementId: 'sql',
        verdict: 'meets',
        reason: 'この構成でも SQL による集計が可能です。SQL という単語だけでは 1 つに絞れません。',
        sourceIds: [sourceId],
        nodeIds: [optionId === 'a' ? 'a-athena' : `${optionId}-engine`],
        edgeIds: [`${optionId}-query`],
      },
      {
        requirementId: 'inplace',
        verdict: 'meets',
        reason: 'S3 の元データを読み取る構成で、分析用データストアへの取り込みを必須にしません。',
        sourceIds: [sourceId],
        nodeIds: [`${optionId}-s3`],
        edgeIds: [`${optionId}-read`],
      },
      {
        requirementId: 'operations',
        verdict: optionId === 'a' ? 'meets' : 'inferior',
        reason:
          optionId === 'a'
            ? 'Athena はインフラの準備・管理が不要です。この問題では最小限の運用で始められます。'
            : '問題文で指定されたクラスターを新規に用意・管理するため、今回の運用負荷の比較では Athena が有利と判断できます。機能要件違反ではありません。',
        sourceIds: optionId === 'a' ? [sourceId] : [sourceId, 'source-athena'],
        nodeIds: [optionId === 'a' ? 'a-athena' : `${optionId}-ops`],
        edgeIds: optionId === 'a' ? [] : [`${optionId}-manage`],
      },
    ],
  };
}

const date = '2026-09-23T00:00:00.000Z';
export const demoDocument: ExplanationDocument = {
  schemaVersion: 1,
  id: 'sample-s3-analysis',
  createdAt: date,
  updatedAt: date,
  question: demoQuestion,
  revisions: [
    {
      id: 'sample-original',
      createdAt: date,
      parentRevisionId: null,
      prompt: '',
      question: demoQuestion,
      explanation: {
        title: 'サンプル解説：決め手は「できるか」から「運用が少ないか」へ',
        shortAnswer: 'A：Athena + Glue Data Catalog',
        answerOptionIds: ['a'],
        answerRationale:
          '3 つとも S3 のデータを SQL で分析できます。今回は新規の分析基盤であり、クラスターの管理が不要な Athena が「運用負荷を最小限」という比較条件に最も合います。',
        assumptions: [
          '架空の練習問題です。B は新規のプロビジョンド RA3、C は常時稼働の EMR on EC2 に限定します。',
          'Redshift Serverless や EMR Serverless に自動で読み替えません。必要な権限と対応リージョンは確保されている前提です。',
        ],
        requirements,
        recommendedArchitectureId: 'graph-a',
        architectures: [
          athena,
          alternative(
            'b',
            'B · 新規 Redshift RA3 + Spectrum',
            'redshift',
            'Redshift RA3 + Spectrum',
            'Spectrum で S3 のデータを分析できますが、この選択肢では新規のプロビジョンド型クラスターを管理します。',
          ),
          alternative(
            'c',
            'C · 常時稼働 EMR on EC2',
            'emr',
            'EMR on EC2 / Spark SQL',
            'Spark SQL で集計できますが、この選択肢では常時稼働する EC2 クラスターを管理します。',
          ),
        ],
        evaluations: [
          evaluation(
            'a',
            '不定期の分析を、クラスター管理なしで開始できます。',
            '今回の条件に適合します。大量の反復クエリでは、別途性能・コストの比較が必要です。',
          ),
          evaluation(
            'b',
            'S3 を直接分析できるものの、新規クラスターの運用が比較上不利です。',
            '既存の Redshift データと S3 のデータを JOIN したい場合などは、有力な候補です。',
          ),
          evaluation(
            'c',
            '機能的には可能ですが、常時稼働クラスターが今回の利用頻度に対して過剰です。',
            'SQL 集計に加えて Spark の独自処理や実行環境の細かい制御が必要なら候補になります。',
          ),
        ],
        learningPoints: [
          '「SQL が使える」だけで決めず、残った構成を運用の条件で比較しましょう。',
          '比較上不利な構成を「絶対にできない」と暗記しないことが大切です。',
          'サービス名に加えて、選択肢に書かれた実行方式や新規・既存の違いを読み取りましょう。',
        ],
        glossary: [
          {
            term: 'サーバーレス',
            description:
              'サーバーが存在しないという意味ではなく、利用者がサーバー群の確保・管理を担わない実行方式です。',
          },
          {
            term: 'Data Catalog',
            description:
              'データの場所や列の型を管理するメタデータの台帳です。元データとは別に扱います。',
          },
          {
            term: '比較上不利',
            description: '実現できるが、問題文の優先条件では他の構成が適しているという評価です。',
          },
        ],
        sources: [
          {
            id: 'source-athena',
            title: 'Amazon Athena FAQ — 概要と Data Catalog',
            url: 'https://aws.amazon.com/athena/faqs/',
            excerpt:
              'Athena is serverless, so there is no infrastructure to set up or manage, and you can start analyzing data immediately.',
            status: 'verified',
            checkedAt: date,
            verificationNote:
              'サンプル作成時に AWS 公式ページの本文と原文引用を照合。個々の構成比較は問題の条件に基づく推論です。',
          },
          {
            id: 'source-redshift',
            title: 'Amazon Redshift Spectrum overview',
            url: 'https://docs.aws.amazon.com/redshift/latest/dg/c-spectrum-overview.html',
            excerpt:
              'This topic describes details for using Redshift Spectrum to efficiently read from Amazon S3.',
            status: 'verified',
            checkedAt: date,
            verificationNote:
              'サンプル作成時に AWS 公式ページの本文と原文引用を照合。選択肢 B の新規 RA3 構成を評価しています。',
          },
          {
            id: 'source-emr',
            title: 'Understanding Amazon EMR clusters',
            url: 'https://docs.aws.amazon.com/emr/latest/ManagementGuide/emr-overview.html',
            excerpt:
              'A cluster is a collection of Amazon Elastic Compute Cloud (Amazon EC2) instances.',
            status: 'verified',
            checkedAt: date,
            verificationNote:
              'サンプル作成時に AWS 公式ページの本文と原文引用を照合。EMR Serverless ではなく EC2 クラスターの説明です。',
          },
        ],
        caveats: [
          'このサンプルは UI 操作用の固定教材です。表示中に新しい AI 生成や公式資料の再確認は行っていません。',
          '図は選択肢の違いに集中した概念図です。IAM、暗号化、クエリ結果の保存先などは省略しています。',
        ],
      },
    },
  ],
};
