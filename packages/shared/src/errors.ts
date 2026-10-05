// Error codes returned by the API. The web app shows MESSAGES[code] — never the raw technical error.

export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'ADDRESS_NOT_FOUND',
  'ADDRESS_AMBIGUOUS',
  'POSTAL_CODE_INVALID',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_QUOTA',
  'PROVIDER_NOT_CONFIGURED',
  'ROUTE_IMPOSSIBLE',
  'ROUTE_TOO_LARGE',
  'NO_DELIVERIES',
  'ROUTE_NOT_EDITABLE',
  'OCR_FAILED',
  'AI_NOT_CONFIGURED',
  'AI_FAILED',
  'AI_IMAGES_DISABLED',
  'IMAGE_TOO_LARGE',
  // client-side only
  'OFFLINE',
  'GPS_DENIED',
  'GPS_UNAVAILABLE',
  'GPS_TIMEOUT',
  'CAMERA_DENIED',
  'CAMERA_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION: 'Alguns campos não estão corretos. Revise e tente novamente.',
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos. Se ainda não tem conta neste servidor, toque em “Criar conta”.',
  EMAIL_TAKEN: 'Já existe uma conta com este e-mail.',
  FORBIDDEN: 'Você não tem acesso a este recurso.',
  NOT_FOUND: 'Não encontramos o que você procurava. Talvez tenha sido apagado.',
  CONFLICT: 'Esta ação conflita com o estado atual. Atualize a tela e tente de novo.',
  RATE_LIMITED: 'Muitas solicitações em pouco tempo. Aguarde alguns segundos.',
  ADDRESS_NOT_FOUND: 'Não conseguimos localizar este endereço. Verifique o número e o código postal.',
  ADDRESS_AMBIGUOUS: 'Encontramos mais de um endereço possível. Escolha o correto.',
  POSTAL_CODE_INVALID: 'O código postal parece inválido. Na Espanha ele tem 5 dígitos (ex.: 29620).',
  PROVIDER_UNAVAILABLE: 'O serviço de mapas não respondeu. Tente novamente em instantes.',
  PROVIDER_QUOTA: 'O limite de uso do serviço de mapas foi atingido. Tente mais tarde.',
  PROVIDER_NOT_CONFIGURED: 'O serviço de mapas não está configurado no servidor.',
  ROUTE_IMPOSSIBLE: 'Não foi possível calcular uma rota até algumas entregas. Verifique os endereços destacados.',
  ROUTE_TOO_LARGE: 'Há entregas demais para uma única rota. Divida em duas rotas.',
  NO_DELIVERIES: 'Adicione pelo menos uma entrega antes de calcular a rota.',
  ROUTE_NOT_EDITABLE: 'Esta rota já foi finalizada e não pode ser alterada.',
  OCR_FAILED: 'Não conseguimos ler a etiqueta. Tente outra foto, com mais luz e sem reflexos.',
  AI_NOT_CONFIGURED: 'A interpretação por IA não está configurada. Confira os dados manualmente.',
  AI_FAILED: 'A IA não conseguiu interpretar a etiqueta. Confira os dados manualmente.',
  AI_IMAGES_DISABLED: 'O envio de imagens para IA está desativado nas configurações.',
  IMAGE_TOO_LARGE: 'A imagem é grande demais. Tente novamente.',
  OFFLINE: 'Sem conexão com a internet. Esta ação precisa de internet.',
  GPS_DENIED: 'Permita o acesso à localização nas configurações do navegador.',
  GPS_UNAVAILABLE: 'Não conseguimos obter sua localização agora.',
  GPS_TIMEOUT: 'A localização demorou demais. Tente em um lugar aberto.',
  CAMERA_DENIED: 'Permita o acesso à câmera nas configurações do navegador.',
  CAMERA_UNAVAILABLE: 'Não foi possível abrir a câmera. Use a opção de enviar foto.',
  INTERNAL: 'Algo deu errado do nosso lado. Tente novamente.',
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Optional structured details (e.g. which deliveries are unreachable, field errors). */
    details?: Record<string, unknown>;
  };
}

export function messageFor(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code as ErrorCode]) || ERROR_MESSAGES.INTERNAL;
}
