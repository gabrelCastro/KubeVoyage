import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * /privacidade — what the service stores and why, in plain language. Every statement here
 * must match the code: when storage changes (schema, cookies, logs, backups), update this.
 */

export const PRIVACY_UPDATED = '2026-10-03'
const OPERATOR = import.meta.env.VITE_OPERATOR_NAME || 'o responsável pelo KubeLearn'
const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || ''
const BACKUP_DAYS = 14

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-fg-muted [&_li]:mt-1.5 [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-5">{children}</div>
    </section>
  )
}

const Contact = () =>
  CONTACT ? (
    <a href={`mailto:${CONTACT}`} className="text-accent hover:underline">
      {CONTACT}
    </a>
  ) : (
    <span>o contato informado no site</span>
  )

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <main className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <a href="/" className="inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition hover:text-fg">
          <ArrowLeft size={14} /> Voltar ao KubeLearn
        </a>
        <h1 className="mt-6 text-[26px] font-semibold tracking-tight">Privacidade</h1>
        <p className="mt-2 text-[13px] text-fg-faint">
          Última atualização: {new Date(PRIVACY_UPDATED + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        <p className="mt-6 text-[14.5px] leading-relaxed text-fg-muted">
          O KubeLearn é operado por <strong className="text-fg">{OPERATOR}</strong>. Esta página explica, sem rodeios, quais dados o KubeLearn guarda,
          por quê, por quanto tempo e como você controla isso, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
        </p>

        <Section title="Em resumo">
          <ul>
            <li>Você pode usar todas as lições sem conta. Nesse caso, seu progresso fica só no seu navegador.</li>
            <li>Com conta, guardamos seu e-mail e seu progresso, para sincronizar entre dispositivos. Nada além do necessário para isso.</li>
            <li>Não há publicidade, rastreadores, analytics de terceiros, nem venda ou compartilhamento de dados para marketing.</li>
            <li>Você pode baixar ou apagar seus dados a qualquer momento, pelo menu da sua conta.</li>
          </ul>
        </Section>

        <Section title="Sem conta">
          <p>
            Seu progresso, o estado do tutorial, o histórico de comandos do terminal e o design criado para o seu app ficam no{' '}
            <strong>armazenamento local do seu navegador</strong> (localStorage). Eles não são enviados ao servidor. Limpar os dados do site no navegador apaga tudo.
          </p>
        </Section>

        <Section title="Com conta">
          <p>Quando você cria uma conta, guardamos:</p>
          <ul>
            <li>
              <strong>Seu e-mail</strong> — para identificar a conta e enviar os links de acesso.
            </li>
            <li>
              <strong>Se você entrar com o GitHub:</strong> o identificador numérico da sua conta GitHub, seu nome público e o endereço da sua foto de perfil. Não
              guardamos nenhum token de acesso ao GitHub, e só ligamos contas por um e-mail que o GitHub confirma como verificado.
            </li>
            <li>
              <strong>Seu progresso</strong> — objetivos concluídos, quando cada lição foi concluída, seu melhor tempo e a última lição aberta.
            </li>
            <li>
              <strong>Datas</strong> de criação da conta e do último acesso.
            </li>
            <li>
              <strong>Sua sessão</strong> — enquanto você estiver conectado (até 30 dias sem uso), para mantê-lo conectado.
            </li>
          </ul>
          <p>
            Os links de acesso enviados por e-mail valem por 10 minutos e servem uma única vez. Guardamos apenas um resumo criptográfico (hash) deles, apagado
            depois do uso ou da expiração.
          </p>
        </Section>

        <Section title="Para que usamos e com qual base legal">
          <ul>
            <li>
              <strong>Conta, acesso e sincronização do progresso</strong> — para prestar o serviço que você pediu ao criar a conta (art. 7º, V, da LGPD).
            </li>
            <li>
              <strong>Segurança e funcionamento</strong> — limitar abusos (como pedidos repetidos de links de acesso) e corrigir erros (legítimo interesse, art.
              7º, IX). Para limitar abusos, o endereço IP fica apenas na memória do servidor, por no máximo uma hora, e não é gravado.
            </li>
          </ul>
          <p>
            Quando algo quebra no seu navegador, o app envia ao nosso servidor uma descrição técnica do erro (mensagem, pilha de chamadas e a lição aberta). Esse
            relatório não leva seu e-mail, sua conta nem seu IP.
          </p>
        </Section>

        <Section title="Cookies">
          <p>Usamos apenas dois cookies, ambos essenciais. Nenhum deles serve para publicidade ou rastreamento.</p>
          <ul>
            <li>
              <strong>kl_session</strong> — mantém você conectado. Só existe se você entrar em uma conta.
            </li>
            <li>
              <strong>XSRF-TOKEN</strong> — protege contra um tipo de ataque (CSRF) em que outro site tenta agir em seu nome.
            </li>
          </ul>
        </Section>

        <Section title="Com quem os dados são compartilhados">
          <p>Não vendemos nem cedemos dados. Para o serviço funcionar, eles passam por:</p>
          <ul>
            <li>
              <strong>Provedor de hospedagem</strong>, onde ficam o servidor e o banco de dados;
            </li>
            <li>
              <strong>Provedor de envio de e-mail</strong>, que recebe seu endereço para entregar os links de acesso;
            </li>
            <li>
              <strong>GitHub</strong>, apenas se você escolher entrar com ele.
            </li>
          </ul>
          <p>Esses provedores atuam como operadores e só tratam os dados para prestar esses serviços.</p>
        </Section>

        <Section title="Por quanto tempo">
          <p>
            Seus dados ficam guardados enquanto a conta existir. Ao apagar a conta, tudo é removido do banco de dados na hora e você é desconectado em todos os
            dispositivos. Cópias de segurança do banco são mantidas por até {BACKUP_DAYS} dias e então descartadas; uma conta apagada desaparece delas nesse prazo.
          </p>
        </Section>

        <Section title="Seus direitos">
          <p>Pela LGPD (art. 18), você pode:</p>
          <ul>
            <li>
              <strong>Acessar e levar seus dados</strong> — use “Baixar meus dados”, no menu da conta. O arquivo traz tudo o que está guardado sobre você.
            </li>
            <li>
              <strong>Apagar seus dados</strong> — use “Apagar conta…”, no menu da conta. Para apagar só o progresso, use “Reiniciar progresso…”.
            </li>
            <li>
              <strong>Corrigir dados, tirar dúvidas ou fazer qualquer outro pedido</strong> — escreva para <Contact />.
            </li>
          </ul>
          <p>
            Se achar que seus dados não foram tratados corretamente, você também pode recorrer à Autoridade Nacional de Proteção de Dados (ANPD).
          </p>
        </Section>

        <Section title="Segurança">
          <p>
            Toda a comunicação usa HTTPS. O cookie de sessão não pode ser lido por scripts da página, e as sessões podem ser encerradas a qualquer momento. Não
            existem senhas para vazar: o acesso é feito por link de uso único ou pelo GitHub.
          </p>
        </Section>

        <Section title="Mudanças nesta página">
          <p>Se o que guardamos mudar, esta página muda junto, e a data no topo é atualizada.</p>
        </Section>
      </main>
    </div>
  )
}
