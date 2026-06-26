// Хелперы для релевантности: ключевые слова резюме, поиск по базе знаний.

export const RESUME_KEYWORDS = [
  'Linux',
  'Kubernetes',
  'Docker',
  'Containerd',
  'Helm',
  'Helm Charts',
  'GitLab CI/CD',
  'GitLab Runner',
  'CI/CD',
  'ArgoCD',
  'GitOps',
  'Bash',
  'Python',
  'Terraform',
  'Ansible',
  'Nginx',
  'PostgreSQL',
  'Redis',
  'Kafka',
  'ClickHouse',
  'Greenplum',
  'MPP',
  'DWH',
  'Prometheus',
  'Grafana',
  'VictoriaMetrics',
  'Alertmanager',
  'ELK',
  'Elasticsearch',
  'Kibana',
  'Loki',
  'Vault',
  'Harbor',
  'S3',
  'Ceph',
  'MinIO',
  'Calico',
  'Ingress',
  'cert-manager',
  'TLS',
  'SSL',
  'systemd',
  'cron',
  'pg_dump',
  'backup',
  'monitoring',
  'logging',
  'observability',
  'troubleshooting',
  'production',
  'DevSecOps',
  'security',
  'IaC',
  'cloud',
  'Yandex Cloud',
  'AWS',
  'GCP',
  'Azure'
];

export function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function extractResumeKeywords(text) {
  const normalized = normalizeText(text);
  return RESUME_KEYWORDS.filter((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zа-яё0-9+#.-])${escaped}([^a-zа-яё0-9+#.-]|$)`, 'i').test(normalized);
  });
}

export function getSearchTerms(text) {
  const normalized = normalizeText(text);
  const words = normalized.match(/[a-zа-яё0-9+#.-]{3,}/gi) || [];
  const stopWords = new Set([
    'что', 'как', 'для', 'или', 'если', 'при', 'это', 'вам', 'ваш', 'ваши',
    'the', 'and', 'for', 'with', 'you', 'your', 'are', 'what', 'how'
  ]);
  return [...new Set(words.filter((word) => !stopWords.has(word)))];
}

// limit=2 и maxChunkChars=600 — дефолты для экономии токенов (~2.5× по RAG-входу).
// maxChunkChars усекает текст каждого возвращённого чанка; если передать <=0 или нечисло — усечение не применяется.
export function pickKnowledgeChunks(context, knowledgeBase, limit = 2, maxChunkChars = 600) {
  const terms = getSearchTerms(context);
  if (terms.length === 0) return [];

  const applyTruncation = typeof maxChunkChars === 'number' && maxChunkChars > 0;

  return knowledgeBase
    .map((chunk) => {
      const text = normalizeText(chunk.text);
      const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((chunk) => applyTruncation ? { ...chunk, text: chunk.text.slice(0, maxChunkChars) } : chunk);
}
