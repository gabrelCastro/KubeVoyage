import { MOD } from '../components/primitives'

/** Every keyboard shortcut, grouped — shown by the shortcuts dialog (?) and on /doc. */
export const SHORTCUTS: { group: string; items: [string[], string][] }[] = [
  {
    group: 'Simulação',
    items: [
      [['Espaço'], 'pausar ou continuar'],
      [['.'], 'avançar uma decisão (com a simulação pausada)'],
      [['R'], 'reiniciar a lição'],
    ],
  },
  {
    group: 'Palco',
    items: [
      [['Delete'], 'apagar o Pod selecionado'],
      [['Esc'], 'tirar a seleção'],
    ],
  },
  {
    group: 'Terminal',
    items: [
      [['/'], 'ir para o terminal'],
      [['Tab'], 'completar comandos e nomes de Pods'],
      [['↑', '↓'], 'navegar no histórico'],
      [['Ctrl', 'R'], 'buscar no histórico'],
      [['Esc'], 'parar o kubectl get pods -w'],
      [['Ctrl', 'L'], 'limpar a tela'],
    ],
  },
  {
    group: 'Geral',
    items: [
      [[MOD, 'K'], 'paleta de comandos'],
      [['?'], 'lista de atalhos'],
    ],
  },
]
