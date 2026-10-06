import { WORKSPACE_RULES } from '@kubelearn/shared'
import type { ReactNode } from 'react'
import { LESSONS } from '../lessons'
import { VISUAL } from '../lib/visual'
import { LIMITS } from '../runtime/program'
import { KIND_ALIASES, KIND_IDS, UNSIMULATED_KINDS, type KindId } from '../sim/cli/resourceKinds'
import { UNSIMULATED_VERBS, USAGE, VERBS } from '../sim/cli/usage'
import { SHORTCUTS } from '../tour/shortcuts'
import { B, C, Code, H4, Kbd, Note, Ol, P, See, Table, TryIt, Ul } from './ui'

/**
 * The content of /doc. Whatever the code already knows — the lessons, the commands and their
 * usage, resource types, Pod states, shortcuts, limits — is rendered from the same data the
 * app uses, so this page can't drift from the tool. The rest is prose: when behavior changes,
 * update it here (docs.test.ts checks the parts that can be checked).
 */

export interface DocSub {
  id: string
  title: string
  body: ReactNode
}

export interface DocSection {
  id: string
  title: string
  /** One line under the title. */
  lead: string
  subs: DocSub[]
}

const lessonById = (id: string) => LESSONS.find((l) => l.id === id)!
const seconds = (ms: number) => `${(ms / 1000).toLocaleString('pt-BR')} s`

/** Aliases accepted for each resource type, in the order a person would type them. */
function aliasesOf(kind: KindId) {
  const names = Object.entries(KIND_ALIASES)
    .filter(([alias, k]) => k === kind && !alias.includes('.'))
    .map(([alias]) => alias)
  return names.sort((a, b) => a.length - b.length)
}

const KIND_LABEL: Record<KindId, string> = {
  pods: 'Pods — os containers rodando',
  deployments: 'Deployments — o estado desejado de um app',
  replicasets: 'ReplicaSets — mantêm N Pods de uma versão',
  services: 'Services — um endereço estável na frente dos Pods',
  endpoints: 'Endpoints — os IPs de Pods Ready por trás de um Service',
  endpointslices: 'EndpointSlices — a forma atual dos Endpoints',
  events: 'Events — o que cada controlador fez, e quando',
  nodes: 'Nodes — as máquinas do cluster',
  configmaps: 'ConfigMaps — configuração fora da imagem',
  horizontalpodautoscalers: 'HorizontalPodAutoscalers — réplicas pela CPU',
  secrets: 'Secrets — valores sensíveis (codificados em base64)',
  jobs: 'Jobs — tarefas que terminam',
  daemonsets: 'DaemonSets — um Pod por node',
}

export const SECTIONS: DocSection[] = [
  // ── começando ─────────────────────────────────────────────────────────────
  {
    id: 'comecando',
    title: 'Começando',
    lead: 'O que é o KubeLearn e como tirar o máximo de uma lição.',
    subs: [
      {
        id: 'o-que-e',
        title: 'O que é o KubeLearn',
        body: (
          <>
            <P>
              O KubeLearn é um lugar para aprender Kubernetes <B>vendo o cluster reagir</B>. Não há um cluster de verdade por trás: é uma simulação educacional do
              comportamento <i>observável</i> do Kubernetes — os mesmos objetos, os mesmos controladores, os mesmos eventos e as mesmas mensagens de erro do{' '}
              <C>kubectl</C> — desenhada no palco enquanto acontece.
            </P>
            <P>
              Você não precisa instalar nada nem ter conta. Tudo roda no seu navegador, e o seu progresso fica salvo nele. Se quiser continuar em outro
              dispositivo, crie uma conta (<See id="conta">Conta e sincronização</See>).
            </P>
            <Ul>
              <li>
                <B>Conceito primeiro, sintaxe depois.</B> Quase todo objetivo dá para cumprir clicando no palco; o terminal mostra o comando equivalente, e você
                aprende os dois.
              </li>
              <li>
                <B>Uma única verdade.</B> Palco, terminal, inspetor, linha do tempo e narração mostram o mesmo estado simulado. O que um mostra, os outros
                confirmam.
              </li>
              <li>
                <B>Erros de verdade.</B> Comandos errados recebem a mesma mensagem que o kubectl real daria — e, quando ajuda, uma explicação em português.
              </li>
            </Ul>
          </>
        ),
      },
      {
        id: 'primeira-licao',
        title: 'Sua primeira lição',
        body: (
          <>
            <Ol>
              <li>
                Abra o KubeLearn. Na primeira visita, um tutorial curto mostra cada parte da tela (para rever, use o menu <B>Ajuda</B> → <i>Rever o tutorial</i>).
              </li>
              <li>
                Leia a ideia da lição no painel da esquerda e siga o primeiro objetivo. Ele sugere um comando — clique nele para colocá-lo no terminal, ou
                digite você mesmo:
              </li>
            </Ol>
            <Code>{`kubectl apply -f backend.yaml
kubectl get pods`}</Code>
            <Ol>
              <li value={3}>
                Veja o palco: o Deployment cria um ReplicaSet, que cria os Pods, que passam por <i>Pending</i>, <i>ContainerCreating</i>, <i>Running</i> e{' '}
                <i>Ready</i>. Clique em qualquer coisa para inspecionar.
              </li>
              <li>Cada objetivo cumprido é marcado sozinho. Quando os obrigatórios acabam, a lição mostra o que aconteceu, contado pelos eventos do cluster.</li>
            </Ol>
            <TryIt lesson="self-healing">Começar pela lição 1</TryIt>
          </>
        ),
      },
      {
        id: 'como-funciona-uma-licao',
        title: 'Como funciona uma lição',
        body: (
          <>
            <Ul>
              <li>
                <B>A ideia.</B> Toda lição começa com uma ideia só, apresentada como dois lados (por exemplo, <i>desired state</i> × <i>actual state</i>).
              </li>
              <li>
                <B>Objetivos.</B> A maioria é verificada pelo estado do cluster: qualquer caminho que chegue lá vale, pelo palco ou pelo terminal. Alguns pedem
                um comando de propósito (como <C>kubectl top</C> ou <C>kubectl drain</C>), porque o comando é o que a lição ensina. Uma vez cumprido, o objetivo
                fica cumprido; os marcados como <i>Bônus</i> são opcionais.
              </li>
              <li>
                <B>Dicas.</B> Nos exercícios em que descobrir é o ponto, a resposta fica escondida atrás de <i>Travou? Mostrar uma dica</i>.
              </li>
              <li>
                <B>Apostila.</B> Cada lição tem um texto de estudo com o porquê de tudo, aberto pelo painel da lição ou pelo menu Ajuda. Termos sublinhados no
                texto (como <i>ReplicaSet</i> ou <i>selector</i>) mostram uma definição curta e levam ao trecho da apostila que os explica.
              </li>
              <li>
                <B>Conclusão.</B> Ao terminar, você vê a história da sua execução, o tempo que levou e o seu melhor tempo, e segue para a próxima lição.
              </li>
              <li>
                <B>Endereço próprio.</B> Cada lição tem uma URL (por exemplo, <C>/#/services</C>). Para recomeçar uma lição do zero, use <Kbd>R</Kbd>.
              </li>
            </Ul>
          </>
        ),
      },
    ],
  },

  // ── interface ─────────────────────────────────────────────────────────────
  {
    id: 'interface',
    title: 'A interface',
    lead: 'Cinco superfícies, um único cluster.',
    subs: [
      {
        id: 'palco',
        title: 'O palco',
        body: (
          <>
            <P>
              O centro da tela é o cluster desenhado: Deployments e Jobs no alto, os ReplicaSets de cada versão, os Pods agrupados pelo node em que rodam, e os
              Services com o tráfego chegando aos Pods. As linhas mostram quem é dono de quem; quando um controlador age, um pulso percorre essa ligação.
            </P>
            <Ul>
              <li>
                <B>Clique</B> em qualquer objeto para abri-lo no inspetor. Com um Pod selecionado, <Kbd>Delete</Kbd> o apaga (o mesmo que{' '}
                <C>kubectl delete pod</C>); <Kbd>Esc</Kbd> tira a seleção.
              </li>
              <li>
                <B>Slots.</B> Cada Pod ocupa um lugar fixo. Quando um Pod some, fica um buraco visível — e o substituto ocupa esse buraco.
              </li>
              <li>
                <B>Tráfego.</B> Pontos saem do Service e chegam aos Pods Ready, em rodízio. Quando não há para quem mandar, a requisição falha na frente do
                Service.
              </li>
              <li>
                <B>Réplicas.</B> Na lição de Scaling, um controle no palco muda as réplicas arrastando; em qualquer lição, o inspetor de um Deployment tem o mesmo
                ajuste.
              </li>
            </Ul>
          </>
        ),
      },
      {
        id: 'estados-dos-pods',
        title: 'Estados dos Pods',
        body: (
          <>
            <P>A cor de um Pod diz em que ponto do ciclo de vida ele está. As mesmas cores aparecem no palco, no inspetor e na linha do tempo.</P>
            <Table
              head={['Estado', 'O que significa']}
              rows={Object.values(VISUAL).map((v) => [
                <span key={v.label} className="inline-flex items-center gap-2 font-medium">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: v.color }} aria-hidden />
                  {v.label}
                </span>,
                v.hint,
              ])}
            />
            <P>
              Um Pod que está rodando mas parou de responder às probes aparece como <B>Não responde</B>: para a API ele está <i>Running</i>, mas não recebe
              tráfego.
            </P>
          </>
        ),
      },
      {
        id: 'inspetor',
        title: 'O inspetor',
        body: (
          <>
            <P>
              Clique em qualquer objeto no palco: a cadeia de ownership dele acende, o resto fica em segundo plano, e a coluna da direita mostra o que importa
              para ele. A aba <B>YAML</B> mostra o objeto como <C>kubectl get … -o yaml</C> mostraria.
            </P>
            <Ul>
              <li>
                <B>Pod:</B> o ciclo de vida, node, IP, imagem, reinícios e labels — que você pode editar ali mesmo, como faria com <C>kubectl label</C>.
              </li>
              <li>
                <B>Deployment:</B> réplicas desejadas (com botões para mudar), selector e os Pods dele.
              </li>
              <li>
                <B>ReplicaSet, Service, DaemonSet, Job:</B> selector, Pods selecionados, cobertura dos nodes, progresso das tarefas.
              </li>
            </Ul>
          </>
        ),
      },
      {
        id: 'linha-do-tempo',
        title: 'A linha do tempo',
        body: (
          <P>
            Embaixo à direita fica o <B>histórico do cluster</B>: cada evento, de quem veio (você, o scheduler, o kubelet, um controlador) e o que fez, na ordem
            em que aconteceu. Clique num evento para selecionar o objeto envolvido. É a mesma informação de <C>kubectl get events</C>, contada como uma história.
          </P>
        ),
      },
      {
        id: 'narracao',
        title: 'Narração',
        body: (
          <P>
            Quando algo importante acontece — um Pod que não fica pronto, um rollout que trava, um HPA sem métricas —, um cartão no palco explica o que houve e,
            quando faz sentido, oferece o comando para investigar. Clique no comando para colocá-lo no terminal.
          </P>
        ),
      },
      {
        id: 'controle-do-tempo',
        title: 'Controle do tempo',
        body: (
          <>
            <P>
              Todo passo de um controlador é uma tarefa agendada com nome. Por isso dá para parar o tempo e olhar com calma. Os controles ficam no alto da tela:
            </P>
            <Table
              head={['Controle', 'O que faz']}
              rows={[
                [<Kbd key="k">Espaço</Kbd>, 'Pausa ou continua a simulação. Pausado, o topo mostra qual é a próxima decisão do cluster.'],
                [<Kbd key="k">.</Kbd>, 'Avança uma única decisão (pausa, se estiver rodando). Ótimo para ver um rollout passo a passo.'],
                ['0,5× · 1× · 2×', 'A velocidade da simulação.'],
                [<Kbd key="k">R</Kbd>, 'Reinicia a lição: cluster e objetivos voltam ao início desta execução.'],
                ['Movimento reduzido', 'Tira as animações (também segue a preferência do sistema).'],
              ]}
            />
            <Note kind="info" title="O tempo aqui é mais lento de propósito">
              Uma recuperação leva alguns segundos no palco para que você consiga acompanhar. Num cluster real, a maior parte disso acontece bem mais rápido.
            </Note>
          </>
        ),
      },
      {
        id: 'paleta-e-ajuda',
        title: 'Paleta de comandos e ajuda',
        body: (
          <>
            <P>
              <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> (<Kbd>⌘</Kbd> <Kbd>K</Kbd> no Mac) abre a paleta: busque e execute ações da simulação, comandos frequentes, outras
              lições ou qualquer objeto do cluster. Qualquer texto que não for uma ação pode ser executado direto no terminal.
            </P>
            <P>
              O menu <B>Ajuda</B> (o <C>?</C> no alto) tem o tutorial, os atalhos de teclado, a apostila da lição atual, esta documentação e a página de
              privacidade.
            </P>
          </>
        ),
      },
    ],
  },

  // ── lições ────────────────────────────────────────────────────────────────
  {
    id: 'licoes',
    title: 'As lições',
    lead: `${LESSONS.length} lições, em ordem: cada uma usa o que a anterior ensinou.`,
    subs: [
      {
        id: 'lista-de-licoes',
        title: 'Todas as lições',
        body: (
          <>
            <Table
              head={['#', 'Lição', 'O que você faz']}
              rows={LESSONS.map((l) => [
                <span key="n" className="font-mono text-fg-faint">
                  {l.number}
                </span>,
                <span key="t">
                  <a href={`/#/${l.id}`} className="font-medium text-fg hover:text-accent">
                    {l.title}
                  </a>
                  <span className="mt-0.5 block text-[11.5px] text-fg-faint">{l.track}</span>
                </span>,
                l.tagline,
              ])}
            />
            <P>
              As lições se apoiam umas nas outras: a versão 1.5 que quebra na lição {lessonById('failures').number} é consertada com um Secret na lição{' '}
              {lessonById('secrets').number}, e as probes da lição {lessonById('probes').number} explicam um problema que um rollout comum não pega.
            </P>
          </>
        ),
      },
      {
        id: 'arquivos-das-licoes',
        title: 'Os manifestos de cada lição',
        body: (
          <>
            <P>
              Cada lição deixa no diretório do terminal os manifestos que vai usar. Liste com <C>ls</C>, leia com <C>cat</C> e aplique com{' '}
              <C>kubectl apply -f</C>.
            </P>
            <Table
              head={['Lição', 'Arquivos']}
              mono={[1]}
              rows={LESSONS.map((l) => [`${l.number}. ${l.title}`, l.files.join('  ')])}
            />
          </>
        ),
      },
    ],
  },

  // ── terminal ──────────────────────────────────────────────────────────────
  {
    id: 'terminal',
    title: 'O terminal',
    lead: 'Um kubectl simulado, com as mensagens do real — e ajuda em português quando você precisa.',
    subs: [
      {
        id: 'terminal-basico',
        title: 'O básico',
        body: (
          <>
            <Ul>
              <li>
                <Kbd>/</Kbd> leva ao terminal de qualquer lugar. <C>k</C> é um atalho para <C>kubectl</C>.
              </li>
              <li>
                <Kbd>Tab</Kbd> completa comandos, tipos, nomes de objetos, flags e valores (inclusive nomes de Pods, que mudam a cada recriação).
              </li>
              <li>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> percorrem o histórico; <Kbd>Ctrl</Kbd> <Kbd>R</Kbd> busca nele; <Kbd>→</Kbd> aceita a sugestão do histórico.
              </li>
              <li>
                <C>clear</C> ou <Kbd>Ctrl</Kbd> <Kbd>L</Kbd> limpam a tela. <C>help</C> lista o que o terminal entende.
              </li>
              <li>
                Nomes de objetos na saída são clicáveis: selecionam o objeto no palco.
              </li>
            </Ul>
            <H4>Entender um comando antes de rodar</H4>
            <P>
              <C>explicar</C> antes de qualquer comando descreve cada parte dele — sem executar nada. E <C>kubectl &lt;comando&gt; --help</C> mostra o uso e
              exemplos.
            </P>
            <Code>{`explicar kubectl get pods -l app=backend -o wide
kubectl rollout --help`}</Code>
          </>
        ),
      },
      {
        id: 'arquivos',
        title: 'Arquivos',
        body: (
          <>
            <Table
              head={['Comando', 'O que faz']}
              mono={[0]}
              rows={[
                ['ls', 'Lista os manifestos desta lição, o app.js e o Dockerfile.'],
                ['cat <arquivo>', 'Mostra um arquivo.'],
                ['echo <texto>', 'Escreve o texto (útil em pipes, como echo … | base64 -d).'],
                ['edit app.js', 'Abre o editor do seu código (veja Seu código nos Pods).'],
              ]}
            />
          </>
        ),
      },
      {
        id: 'comandos-kubectl',
        title: 'Comandos do kubectl',
        body: (
          <>
            <P>
              Estes são os comandos simulados. Para cada um, <C>kubectl &lt;comando&gt; --help</C> mostra o mesmo texto no terminal.
            </P>
            <div className="mt-4 space-y-3">
              {VERBS.map((verb) => {
                const u = USAGE[verb]
                return (
                  <div key={verb} id={`kubectl-${verb}`} className="scroll-mt-32 rounded-xl border border-line bg-panel/50 px-4 py-3 lg:scroll-mt-24">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <code className="font-mono text-[13px] font-semibold text-accent">kubectl {verb}</code>
                      <span className="text-[13.5px] text-fg-muted">{u.what}</span>
                    </div>
                    <div className="mt-2 space-y-0.5">
                      {u.use.map((line) => (
                        <code key={line} className="block font-mono text-[12px] text-fg [overflow-wrap:anywhere]">
                          {line}
                        </code>
                      ))}
                    </div>
                    {u.examples && (
                      <div className="mt-2 border-t border-line pt-2">
                        {u.examples.map((line) => (
                          <code key={line} className="block font-mono text-[12px] text-fg-faint [overflow-wrap:anywhere]">
                            {line}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        ),
      },
      {
        id: 'tipos-de-recurso',
        title: 'Tipos de recurso',
        body: (
          <>
            <P>
              Use qualquer um dos nomes abaixo; <C>all</C> lista Pods, Services, Deployments e ReplicaSets de uma vez. As formas <C>tipo/nome</C> (
              <C>deploy/backend</C>) e listas (<C>get deploy,rs</C>) também valem.
            </P>
            <Table
              head={['Tipo', 'Nomes aceitos']}
              mono={[1]}
              rows={KIND_IDS.map((k) => [KIND_LABEL[k], aliasesOf(k).join(' · ')])}
            />
          </>
        ),
      },
      {
        id: 'saida-e-filtros',
        title: 'Saída e filtros',
        body: (
          <>
            <Table
              head={['Flag', 'O que faz', 'Exemplo']}
              mono={[0, 2]}
              rows={[
                ['-o wide', 'Colunas extras (IP, node, imagem…).', 'kubectl get pods -o wide'],
                ['-o yaml | json', 'O objeto inteiro, como a API o guarda.', 'kubectl get deploy backend -o yaml'],
                ['-o name', 'Só tipo/nome.', 'kubectl get pods -o name'],
                ['-o jsonpath=…', 'Um campo específico.', "kubectl get secret db-credentials -o jsonpath='{.data.DATABASE_URL}'"],
                ['-l', 'Filtra por labels: =, ==, !=, in (…), notin (…), chave, !chave.', "kubectl get pods -l 'app in (backend,frontend)'"],
                ['--show-labels · -L', 'Mostra todas as labels, ou uma coluna por label.', 'kubectl get pods -L app'],
                ['--field-selector', 'Filtra por campo (status.phase, spec.nodeName, metadata.name).', 'kubectl get pods --field-selector status.phase!=Running'],
                ['--sort-by', 'Ordena por um campo.', 'kubectl get pods --sort-by=.metadata.creationTimestamp'],
                ['-w', 'Continua acompanhando: cada mudança vira uma linha. Esc ou outro comando param.', 'kubectl get pods -w'],
                ['-A · -n default', 'Todos os namespaces / o namespace default (aqui só existe ele).', 'kubectl get pods -A'],
                ['--no-headers', 'Sem a linha de cabeçalho (bom com wc -l).', 'kubectl get pods --no-headers | wc -l'],
              ]}
            />
          </>
        ),
      },
      {
        id: 'pipes',
        title: 'Pipes',
        body: (
          <>
            <P>
              Depois de um <C>|</C>, o terminal entende alguns comandos de texto — o suficiente para os truques mais comuns do dia a dia:
            </P>
            <Table
              head={['Comando', 'O que faz']}
              mono={[0]}
              rows={[
                ['grep [-i] [-v] [-c] [-E] [-w] PADRÃO', 'Filtra linhas (sem diferenciar maiúsculas, invertido, contando, regex estendida, palavra inteira).'],
                ['head -n N · tail -n N', 'As primeiras ou últimas N linhas.'],
                ['wc -l', 'Conta as linhas.'],
                ['sort', 'Ordena as linhas.'],
                ['base64 -d', 'Decodifica base64 — veja como um Secret não esconde nada.'],
              ]}
            />
            <Code>{`kubectl get pods | grep -c Running
kubectl get secret db-credentials -o jsonpath='{.data.DATABASE_URL}' | base64 -d`}</Code>
          </>
        ),
      },
      {
        id: 'de-dentro-do-cluster',
        title: 'Testando de dentro do cluster',
        body: (
          <>
            <P>
              Um Pod temporário com <C>--rm -it</C> roda um comando e some. É assim que se testa um Service do ponto de vista de outro Pod: DNS → ClusterIP →
              kube-proxy → um dos endpoints.
            </P>
            <Code>{`kubectl run t --rm -it --image=busybox --restart=Never -- wget -qO- http://backend
kubectl run dns --rm -it --image=busybox --restart=Never -- nslookup backend`}</Code>
            <P>
              <C>wget</C>, <C>curl</C> e <C>nslookup</C> funcionam aqui. Se o Service não tem endpoints, a porta está errada ou o <C>targetPort</C> não bate
              com o container, a resposta diz exatamente onde o caminho quebrou. Pods rodando o <See id="seu-codigo">seu código</See> respondem com o que o seu
              código devolveu.
            </P>
          </>
        ),
      },
      {
        id: 'o-que-nao-e-simulado',
        title: 'O que não é simulado',
        body: (
          <>
            <P>
              Comandos reais que ainda não existem aqui são reconhecidos — o terminal diz para que servem, em vez de fingir que não existem:
            </P>
            <Table
              head={['Comando', 'Para que serve no kubectl real']}
              mono={[0]}
              rows={Object.entries(UNSIMULATED_VERBS).map(([verb, what]) => [`kubectl ${verb}`, what])}
            />
            <P>
              Tipos fora da simulação (como {[...new Set(UNSIMULATED_KINDS.filter((k) => k.length > 3))].slice(0, 6).join(', ')}) também são reconhecidos e
              avisados. Flags que mudariam o resultado e não são simuladas (<C>--dry-run</C>, <C>--context</C>, <C>--all-containers</C>…) são recusadas com
              uma explicação, para que nada seja feito pela metade.
            </P>
            <Note kind="info" title="Um cluster de treino">
              O cluster tem 3 nodes. Para caber no palco, Deployments vão até 8 réplicas, e um HPA até <C>--max=8</C>.
            </Note>
          </>
        ),
      },
    ],
  },

  // ── seu app ───────────────────────────────────────────────────────────────
  {
    id: 'seu-app',
    title: 'Seu app',
    lead: 'O que os seus Pods servem, como um visitante vê — e versões que você publica.',
    subs: [
      {
        id: 'janela-do-app',
        title: 'A janela do app',
        body: (
          <>
            <P>
              Na coluna da direita, <B>Seu app</B> mostra o app como quem está do lado de fora: os visitantes chegam pelo Service (o endereço{' '}
              <C>http://backend</C>) e cada um é atendido pelo Pod que o Service escolheu — as mesmas requisições desenhadas no palco.
            </P>
            <Ul>
              <li>Cada quadrado é um visitante: a cor e o ícone dizem qual versão o atendeu; passe o mouse para ver o Pod.</li>
              <li>Sem nenhum Pod Ready, os visitantes são recusados e aparecem em vermelho.</li>
              <li>Durante um rollout, <i>no ar agora</i> mostra quantos Pods de cada versão estão respondendo.</li>
            </Ul>
          </>
        ),
      },
      {
        id: 'estudio',
        title: 'Criando e publicando versões',
        body: (
          <>
            <P>
              <B>Criar seu app</B> (ou <B>Editar</B>) abre o estúdio: nome, ícone, cor e mensagem. A versão inicial é a imagem das lições (
              <C>ghcr.io/kubelearn/backend:1.4</C>).
            </P>
            <Ol>
              <li>
                Em <B>Nova versão</B>, mude o que quiser e publique. Isso é o <C>docker build && docker push</C>: vira uma imagem com tag própria —{' '}
                <C>2.0</C>, <C>2.1</C>… —, e uma imagem publicada <B>nunca muda</B>.
              </li>
              <li>
                <B>Implantar no cluster</B> coloca no terminal o comando que faz o rollout:
              </li>
            </Ol>
            <Code>{`kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:2.0`}</Code>
            <P>
              Marque <B>Publicar com um bug</B> para gerar uma versão que esquece a variável <C>DATABASE_URL</C>: o container quebra ao iniciar, como a 1.5 da
              lição de falhas — e você pratica investigar e voltar atrás com segurança.
            </P>
          </>
        ),
      },
      {
        id: 'mudanca-dentro-do-container',
        title: 'Mudanças feitas dentro do container',
        body: (
          <>
            <P>
              No inspetor de um Pod, <B>Editar direto no container…</B> faz o que seria entrar com <C>kubectl exec</C> e trocar um arquivo do app lá dentro. Só
              aquele Pod responde diferente — e nada no Deployment, no ReplicaSet ou no <C>-o yaml</C> do Pod registra a mudança.
            </P>
            <Note kind="warn" title="Ela some com o Pod">
              Apague o Pod e o substituto nasce do template do Deployment, que nunca soube da mudança. É a razão de toda mudança de verdade virar uma imagem
              nova.
            </Note>
          </>
        ),
      },
    ],
  },

  // ── seu código ────────────────────────────────────────────────────────────
  {
    id: 'seu-codigo',
    title: 'Seu código nos Pods',
    lead: 'Escreva o app.js, gere uma imagem, faça o rollout: os Pods rodam o seu código de verdade.',
    subs: [
      {
        id: 'fluxo',
        title: 'Do código ao cluster',
        body: (
          <>
            <Ol>
              <li>
                <B>Escreva.</B> <C>edit app.js</C> abre o editor. Comece de um modelo ou do zero; tudo é salvo enquanto você digita.
              </li>
              <li>
                <B>Teste.</B> O botão <B>Testar</B> roda o código fora do cluster e mostra o que ele imprimiu e o que respondeu em <C>/</C> e{' '}
                <C>/healthz</C>.
              </li>
              <li>
                <B>Gere a imagem.</B> <B>Gerar imagem</B> roda no terminal o <C>docker build</C> com a próxima tag livre — ou digite com a tag que quiser.
              </li>
              <li>
                <B>Faça o rollout.</B> Troque a imagem do Deployment, ou rode a imagem num Job.
              </li>
            </Ol>
            <Code>{`edit app.js
docker build -t backend:2.0 .
kubectl set image deployment/backend backend=ghcr.io/kubelearn/backend:2.0
kubectl logs -l app=backend`}</Code>
            <Note kind="tip" title="A imagem não muda depois de gerada">
              Editar o app.js depois do build não muda nada no cluster. Para mudar o que roda, gere outra imagem (outra tag) e faça outro rollout — exatamente
              como no mundo real.
            </Note>
          </>
        ),
      },
      {
        id: 'contrato',
        title: 'Como escrever o app.js',
        body: (
          <>
            <P>
              O arquivo é JavaScript, como um módulo do Node. Se ele define uma função <C>handle</C>, o container é um <B>servidor</B>: cada requisição chama
              essa função. Sem ela, é uma <B>tarefa</B>: roda até o fim e termina.
            </P>
            <Code lang="js">{`console.log('servidor iniciando')   // vai para kubectl logs

function handle(req, env) {
  if (req.path === '/healthz') return 'ok'          // o que as probes perguntam
  return env.APP_MESSAGE || 'Olá do cluster!'       // o que os visitantes veem
}`}</Code>
            <Table
              head={['O que', 'Como funciona']}
              rows={[
                [<C key="c">req</C>, <>Um objeto com <C>method</C> (sempre GET), <C>path</C> e <C>headers</C>.</>],
                [<C key="c">env</C>, <>As variáveis de ambiente do container — o que ConfigMaps e Secrets definem (<C>envFrom</C>). Também em <C>process.env</C>.</>],
                ['Responder', <>Uma string vira <C>200</C> com esse texto. <C>{'{ status, body }'}</C> escolhe o status (100–599). Outro objeto vira JSON. Sem retorno, <C>204</C>.</>],
                ['async', <><C>handle</C> pode ser <C>async</C> e usar <C>await</C>.</>],
                ['Logs', <><C>console.log</C>, <C>info</C> e <C>debug</C> vão para <C>kubectl logs</C>; <C>warn</C> e <C>error</C> também, com o prefixo <C>warn:</C> / <C>error:</C>.</>],
                ['Erros', <>Uma exceção ao iniciar derruba o container. Uma exceção dentro de <C>handle</C> vira <C>500</C> só naquela requisição. Uma exceção que escapa depois (uma Promise rejeitada, um erro num timer) encerra o processo, como no Node.</>],
                ['Sair', <><C>process.exit(0)</C> termina com sucesso; <C>process.exit(1)</C> (ou qualquer código ≠ 0), com erro.</>],
                ['Módulos', <><C>module.exports = handle</C> (ou <C>{'{ handle }'}</C>) também define o servidor. <C>require</C> existe, mas não há pacotes: nem do npm, nem do Node.</>],
              ]}
            />
          </>
        ),
      },
      {
        id: 'como-o-cluster-reage',
        title: 'Como o cluster reage ao seu código',
        body: (
          <>
            <P>
              O kubelet pergunta <C>/healthz</C> para decidir se o Pod está pronto, e os visitantes recebem o que <C>/</C> devolve. Daí sai tudo o que você vê:
            </P>
            <Table
              head={['Se o código…', 'Num Deployment', 'Num Job']}
              rows={[
                ['define handle e /healthz responde 2xx/3xx', 'Ready: entra no Service e atende os visitantes.', 'Nunca termina: um servidor fica esperando para sempre.'],
                ['lança um erro ao iniciar', 'CrashLoopBackOff; o rollout para com segurança e os Pods antigos continuam atendendo.', 'Falha (exit code 1) e é tentado de novo até o backoffLimit.'],
                ['não define handle e termina bem', 'Termina e é reiniciado sem parar: CrashLoopBackOff. Tarefas são trabalho para Jobs.', 'Completed (exit code 0).'],
                [<>/healthz responde 4xx/5xx ou lança erro</>, 'Running, mas nunca Ready: fora do Service (evento Unhealthy com o status).', '—'],
                [<>trava (/healthz nunca responde)</>, 'A readiness probe falha; com uma liveness probe, o kubelet reinicia o container.', 'Uma tarefa travada nunca termina.'],
              ]}
            />
            <P>
              <C>wget</C>/<C>curl</C> de dentro do cluster e a janela do app mostram a resposta do seu código; um erro aparece como um quadrado vermelho com o
              status. O mesmo código pode se comportar diferente em cada ambiente — por exemplo, falhar sem um Secret e funcionar com ele.
            </P>
            <TryIt lesson="services">Experimentar na lição de Services</TryIt>
          </>
        ),
      },
      {
        id: 'editor',
        title: 'O editor',
        body: (
          <Ul>
            <li>
              <B>Modelos:</B> Servidor, Lê a config (precisa de <C>DATABASE_URL</C>), Quebra ao iniciar, Trava, Não está pronto (<C>/healthz</C> com 503) e
              Tarefa (Job). Cada um mostra uma reação diferente do cluster.
            </li>
            <li>
              <B>Testar</B> roda o código sem as variáveis de ambiente do cluster; o resultado fica apagado quando você muda o código depois do teste.
            </li>
            <li>
              <Kbd>Tab</Kbd> indenta, <Kbd>Ctrl</Kbd> <Kbd>S</Kbd> confirma que está salvo, <Kbd>Esc</Kbd> fecha. <B>Restaurar modelo</B> volta ao código
              inicial.
            </li>
          </Ul>
        ),
      },
      {
        id: 'docker',
        title: 'docker build e tags',
        body: (
          <>
            <Code>{`docker build -t backend:2.0 .
docker build -t ghcr.io/kubelearn/backend:com-cache .
docker images`}</Code>
            <Ul>
              <li>
                O nome é sempre o repositório <C>backend</C> (curto ou completo), e a tag é obrigatória: sem ela o docker usaria <C>latest</C>, que muda a cada
                build.
              </li>
              <li>
                Tags: letras, números, <C>_</C>, <C>.</C> e <C>-</C>, até 32 caracteres, sem começar com <C>.</C> ou <C>-</C>. As tags <C>1.x</C> são das
                lições e <C>latest</C> não é aceita.
              </li>
              <li>
                Uma tag usada nunca é sobrescrita: para mudar, use outra. Cabem até {WORKSPACE_RULES.releasesMax} imagens suas.
              </li>
              <li>
                O build já publica no registry do curso. <C>docker run</C> não existe aqui: quem roda containers é o cluster.
              </li>
            </Ul>
          </>
        ),
      },
      {
        id: 'limites',
        title: 'Limites',
        body: (
          <>
            <Table
              head={['Limite', 'Valor', 'O que acontece']}
              rows={[
                ['Tempo para iniciar', seconds(LIMITS.loadMs), 'Passou disso, o processo conta como travado.'],
                ['Tempo por requisição', seconds(LIMITS.requestMs), 'Passou disso, aquela requisição fica sem resposta.'],
                ['Tamanho do app.js', `${LIMITS.codeChars.toLocaleString('pt-BR')} caracteres`, 'O editor não deixa passar.'],
                ['Linhas de log', `${LIMITS.logLines}`, 'O resto é cortado, com um aviso.'],
                ['Tamanho de uma linha de log', `${LIMITS.logChars} caracteres`, 'Cortada com …'],
                ['Tamanho de uma resposta', `${LIMITS.bodyChars.toLocaleString('pt-BR')} caracteres`, 'Cortada com …'],
                ['Imagens suas', `${WORKSPACE_RULES.releasesMax}`, 'O build seguinte é recusado.'],
              ]}
            />
            <P>
              O cluster só pergunta <C>/</C> e <C>/healthz</C> ao seu código; um <C>wget</C> para outro caminho explica isso em vez de inventar uma resposta.
              Cada combinação de código e ambiente roda uma vez, e o resultado vale para todos os Pods iguais.
            </P>
          </>
        ),
      },
      {
        id: 'isolamento',
        title: 'Onde o código roda',
        body: (
          <Note kind="info" title="Só no seu navegador, isolado">
            <p>
              O código roda num Web Worker descartável, sem acesso à página, aos seus dados, aos cookies ou à rede (as APIs de rede são removidas antes, e em
              produção uma política de segurança própria bloqueia qualquer conexão). Um laço infinito é interrompido pelo tempo-limite sem travar a página.
            </p>
            <p>Com conta, o código é guardado no servidor para sincronizar — como texto. Ele nunca é executado lá.</p>
          </Note>
        ),
      },
    ],
  },

  // ── conta ─────────────────────────────────────────────────────────────────
  {
    id: 'conta',
    title: 'Conta e sincronização',
    lead: 'Opcional. Serve para continuar de onde parou em outro dispositivo.',
    subs: [
      {
        id: 'sem-conta',
        title: 'Sem conta',
        body: (
          <P>
            Todas as lições funcionam sem conta. O progresso, o histórico do terminal e o seu app ficam salvos no navegador deste dispositivo. Limpar os dados do
            site apaga tudo.
          </P>
        ),
      },
      {
        id: 'entrar',
        title: 'Entrar',
        body: (
          <>
            <P>
              Clique em <B>Entrar</B> e receba um link de acesso por e-mail (vale por 10 minutos, uma vez só) ou use o GitHub, quando disponível. Não há senha.
            </P>
            <P>
              Ao entrar, o que você fez neste dispositivo é somado ao que a conta já tinha. Se o dispositivo guardava o app de <i>outra</i> conta, ele é
              descartado daqui — nunca enviado para a sua.
            </P>
          </>
        ),
      },
      {
        id: 'o-que-sincroniza',
        title: 'O que sincroniza, e como',
        body: (
          <>
            <Table
              head={['O que', 'Como os dispositivos se combinam']}
              rows={[
                ['Objetivos cumpridos', 'Somam: cumprido em um, cumprido em todos.'],
                ['Lições concluídas e melhor tempo', 'Vale a primeira conclusão e o menor tempo.'],
                ['Onde parou', 'A lição aberta por último.'],
                ['Design e código do seu app', 'A edição mais recente de cada um (separadamente).'],
                ['Imagens publicadas', 'Somam. Se dois dispositivos publicaram a mesma tag, fica a primeira.'],
              ]}
            />
            <P>
              Tudo é salvo primeiro no dispositivo e enviado em seguida — offline, o envio espera a conexão voltar. O ponto no seu avatar mostra o estado da
              sincronização.
            </P>
          </>
        ),
      },
      {
        id: 'sair',
        title: 'Sair e apagar',
        body: (
          <>
            <P>
              Ao sair, o que acabou de mudar é enviado antes, e o dispositivo esquece o progresso e o app (eles estão na conta). Se alguma mudança do app não
              conseguir chegar à conta, ela fica no dispositivo e você é avisado.
            </P>
            <P>
              No menu da conta, <B>Baixar meus dados</B> entrega tudo o que está guardado sobre você, e <B>Apagar conta</B> apaga tudo, de vez. Os detalhes estão
              na{' '}
              <a href="/privacidade" className="text-accent underline decoration-accent/30 underline-offset-[3px] hover:decoration-accent">
                página de privacidade
              </a>
              .
            </P>
          </>
        ),
      },
    ],
  },

  // ── atalhos ───────────────────────────────────────────────────────────────
  {
    id: 'atalhos',
    title: 'Atalhos de teclado',
    lead: 'Fora do terminal e de campos de texto, salvo indicação. Pressione ? no app para vê-los a qualquer hora.',
    subs: SHORTCUTS.map((g) => ({
      id: `atalhos-${g.group.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}`,
      title: g.group,
      body: (
        <Table
          head={['Teclas', 'O que faz']}
          rows={g.items.map(([keys, what]) => [
            <span key="k" className="inline-flex flex-wrap gap-1">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>,
            what.charAt(0).toUpperCase() + what.slice(1),
          ])}
        />
      ),
    })),
  },

  // ── simulação ─────────────────────────────────────────────────────────────
  {
    id: 'simulacao',
    title: 'A simulação e o Kubernetes real',
    lead: 'O que é fiel, o que é simplificado — e por quê.',
    subs: [
      {
        id: 'o-que-e-fiel',
        title: 'O que é fiel',
        body: (
          <Ul>
            <li>
              Os controladores e suas decisões: Deployment → ReplicaSet → Pods, garbage collector, rollouts com <i>maxSurge</i>/<i>maxUnavailable</i>,
              scheduler, kubelet, probes, HPA, Jobs com backoff, DaemonSets, cordon e drain.
            </li>
            <li>A saída do kubectl: colunas, nomes gerados, mensagens de erro, eventos e o YAML dos objetos.</li>
            <li>As consequências: um Service sem endpoints, um ConfigMap que só chega no próximo restart, um Secret que é só base64.</li>
          </Ul>
        ),
      },
      {
        id: 'o-que-e-diferente',
        title: 'O que é diferente',
        body: (
          <Ul>
            <li>
              <B>O tempo</B> é esticado e controlável, para dar para ver cada passo.
            </li>
            <li>
              <B>O tráfego</B> é um desenho: requisições em rodízio para os endpoints que a simulação calculou, não pacotes de rede.
            </li>
            <li>
              <B>O cluster</B> é pequeno (3 nodes, um namespace) e só tem os tipos que as lições usam.
            </li>
            <li>
              <B>As imagens das lições</B> têm comportamentos combinados: a <C>backend:1.4</C> funciona, a <C>1.5</C> quebra sem <C>DATABASE_URL</C>, a{' '}
              <C>1.6</C> trava depois de um tempo, a <C>relatorio:1.1</C> falha. Só as imagens geradas do seu app.js rodam código de verdade.
            </li>
          </Ul>
        ),
      },
    ],
  },

  // ── perguntas ─────────────────────────────────────────────────────────────
  {
    id: 'perguntas',
    title: 'Perguntas frequentes',
    lead: 'Quando algo não sai como esperado.',
    subs: [
      {
        id: 'objetivo-nao-marca',
        title: 'Fiz o que o objetivo pede, mas ele não foi marcado',
        body: (
          <P>
            Os objetivos olham o estado do cluster, que leva um tempo para chegar lá — espere os Pods ficarem Ready (ou continue a simulação, se estiver
            pausada). Se ainda assim não marcar, compare com o comando sugerido ou abra a dica.
          </P>
        ),
      },
      {
        id: 'comando-nao-reconhecido',
        title: 'O terminal não reconhece um comando',
        body: (
          <P>
            Rode <C>help</C> para ver o que existe e <C>explicar &lt;comando&gt;</C> para entender cada parte. Comandos do kubectl real que não são simulados
            dizem isso (<See id="o-que-nao-e-simulado">lista</See>). Erros de digitação recebem uma sugestão.
          </P>
        ),
      },
      {
        id: 'codigo-nao-mudou',
        title: 'Mudei o app.js, mas os Pods continuam iguais',
        body: (
          <P>
            Uma imagem é imutável: os Pods rodam o código de quando a imagem foi gerada. Gere uma imagem nova com outra tag (<C>docker build -t backend:2.1 .</C>)
            e faça o rollout com <C>kubectl set image</C>.
          </P>
        ),
      },
      {
        id: 'pod-nao-fica-ready',
        title: 'Meu Pod não fica Ready',
        body: (
          <>
            <P>Investigue como num cluster real:</P>
            <Code>{`kubectl describe pod <nome>     # os eventos dizem por quê
kubectl logs <nome> --previous  # a saída da execução que quebrou
kubectl get endpointslices -l kubernetes.io/service-name=backend`}</Code>
            <P>
              Com o seu código, os motivos comuns são uma exceção ao iniciar, um <C>/healthz</C> que não responde 2xx ou uma variável de ambiente que falta.
            </P>
          </>
        ),
      },
      {
        id: 'recomecar',
        title: 'Como recomeçar',
        body: (
          <P>
            <Kbd>R</Kbd> recomeça a lição atual. Para zerar o progresso de todas as lições, use <B>Reiniciar progresso…</B> no menu da conta (ou limpe os dados
            do site, sem conta).
          </P>
        ),
      },
    ],
  },
]
