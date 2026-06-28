# Balkao — Verificação de Identidade via Pluggy (Open Finance)

## 1. Objetivo

Verificar que um usuário do Balkao (comprador ou vendedor — papéis intercambiáveis, mesma identidade) é, de fato, quem diz ser, e que ele tem posse real de uma conta bancária vinculada ao CPF/CNPJ que ele cadastrou.

Essa verificação é **única por usuário**, não por papel: a mesma identidade verificada vale para comprar e vender, já que qualquer usuário pode assumir os dois papéis em momentos diferentes.

## 2. Por que Pluggy, e por que não outras abordagens

| Abordagem | Por que foi descartada |
|---|---|
| SERPRO (Consulta CPF/CNPJ) | Confirma que o CPF/CNPJ existe e está regular, mas não confirma que quem está cadastrando é o titular. Para PJ, "é sócio" exclui operadores legítimos não-sócios (funcionário autorizado). |
| Consulta de chave Pix (Asaas) | CPF retornado vem mascarado; sujeito ao Token Bucket do DICT/Bacen (5 consultas/min, ~2.880/dia) — gargalo de throughput em picos de cadastro. |
| Transferência Pix de valor aleatório (challenge-response) | Custo de R$2–7 por verificação (transferência de saída + recebimento de volta), inviável em volume. |
| Unico / idwall / Certta (documento + selfie) | Sem preço público, modelo enterprise via contrato comercial, inadequado para fase atual do Balkao. |
| gov.br Login Único | Restrito a serviços públicos por decreto — empresa privada com fins lucrativos não é elegível. |

**Pluggy resolve os dois pontos de uma vez:**
- **Identidade real**: login OAuth dentro do próprio banco do usuário — prova posse ativa da credencial, sem nunca expor a senha à Pluggy ou ao Balkao.
- **Posse de conta**: a Identity API retorna nome/CPF (ou CNPJ) do titular da conta conectada, sem máscara, vindo diretamente da autenticação bancária — não de uma consulta a terceiro.

## 3. Princípio de verificação — Pessoa Física

> Ter acesso de fato a uma conta bancária regulada, vinculada a um CPF, já é prova suficiente de identidade — porque o próprio banco já fez esse KYC ao conceder o acesso.

**Fluxo:**
1. Usuário se cadastra no Balkao com CPF (auto-declarado).
2. Usuário conecta o próprio banco via Pluggy Connect Widget (OAuth, dentro do Open Finance regulado).
3. Identity API retorna `{nome, cpf}` do titular da conta conectada.
4. Sistema compara CPF declarado no cadastro vs. CPF retornado pela Pluggy.
5. Se baterem → conta verificada. Se não baterem → rejeitar, pedir reconexão com a conta correta.

## 4. Princípio de verificação — Pessoa Jurídica

> Ter acesso à movimentação de uma conta bancária PJ — seja como sócio formal ou autorizado bancário — já é prova suficiente de legitimidade para operar em nome da empresa. O próprio banco só concede esse acesso a quem a empresa autorizou.

Isso **substitui** a abordagem inicialmente considerada (SERPRO Consulta Empresa + comparação com quadro societário), que foi descartada por dois motivos:
- Não verifica quem está digitando o CNPJ (qualquer um pode informar um CNPJ de terceiro).
- Exigir que o usuário seja sócio formal excluiria o caso de uso mais comum (funcionário/gerente de confiança operando o canal de vendas, sem ser sócio).

**Fluxo:**
1. Usuário se cadastra como PJ, informando o CNPJ da empresa.
2. Usuário conecta a conta bancária **da empresa** via Pluggy Connect Widget (fluxo Business).
3. Identity API retorna `{razão social ou nome, cnpj}` do titular da conta.
4. Sistema compara CNPJ declarado no cadastro vs. CNPJ retornado pela Pluggy.
5. Se baterem → empresa verificada, e o usuário (pessoa física logando) fica associado como operador autorizado daquele CNPJ.

**Caso de múltipla alçada:** quando a conta PJ exige aprovação de mais de um sócio/responsável para liberar dados (comum em contas empresariais), a Pluggy já modela isso nativamente — o `item` fica em status de aguardando autorização até que a segunda pessoa aprove. O Balkao deve tratar esse status como um estado intermediário (`pending_multi_approval`), não como falha.

## 5. Por que forçar conexão via Open Finance regulado (não Direct Connector)

A Pluggy oferece dois modos de conexão:
- **Open Finance regulado**: login via OAuth 2.0, dentro do site/app oficial do banco, sob regulação do Bacen. A senha do usuário nunca passa pela Pluggy ou pelo Balkao.
- **Direct Connector**: para bancos fora do Open Finance, a Pluggy ainda usa credenciais inseridas diretamente no widget (técnica mais antiga, pré-Open Finance).

**Decisão de arquitetura: o Balkao deve aceitar apenas conectores com `isOpenFinance: true`.**

Motivo: é o modo que garante a prova de identidade mais forte (autenticação real, no domínio do próprio banco, sem intermediação de credenciais) — que é exatamente a propriedade que sustenta todo o racional da Seção 3 e 4. Conectores fora do Open Finance não oferecem essa garantia e não devem ser aceitos para fins de verificação de identidade (mesmo que sejam aceitáveis para outros produtos, como leitura de extrato).

## 6. Integração técnica

### 6.1 Credenciais e ambientes
- Criar aplicação no dashboard Pluggy → obter `clientId` + `clientSecret`.
- Ambientes separados: **Sandbox** (gratuito, sem prazo de expiração, dados mockados) e **Produção** (requer plano pago).
- `apiKey`: obtida via `clientId`/`clientSecret`, válida por 2 horas.
- `connectToken`: obtido a partir da `apiKey`, válido por 30 minutos, usado para abrir o widget.

### 6.2 Fluxo de conexão
1. Backend do Balkao gera `connectToken`.
2. Frontend/WhatsApp flow abre o **Pluggy Connect Widget** com esse token.
3. Passar `clientUserId` no formato recomendado: `"nome | email | cpf_ou_cnpj"`, para cruzar a conexão com o cadastro interno do Balkao.
4. Widget filtra/exibe apenas conectores com `isOpenFinance: true` (configurável via customização do widget).
5. Usuário escolhe o banco, autentica no ambiente do próprio banco, autoriza o consentimento.
6. Conexão resultante gera um `item` (representa o vínculo usuário↔instituição↔dados).

### 6.3 Consumo do dado de identidade
- Consultar a **Identity API** do `item` criado.
- Extrair `{nome, cpf}` (PF) ou `{razão social, cnpj}` (PJ).
- Comparar contra o dado declarado no cadastro do Balkao.
- Persistir apenas o resultado da comparação (`verified: true/false`) e metadados não sensíveis (data da verificação, `itemId`) — não há necessidade de reter o dado bruto retornado pela Pluggy além do necessário para auditoria.

### 6.4 Revogação e ciclo de vida
- Revogar consentimento = deletar o `item` via API. Isso encerra a conexão e remove os dados associados do lado da Pluggy.
- Itens de Sandbox não atualizados em 30 dias são deletados automaticamente — irrelevante para produção, relevante para ambiente de testes.

### 6.5 Teste em Sandbox (sem custo)
CPFs de teste para simular o fluxo completo de Open Finance:

| Cenário | CPF de teste |
|---|---|
| Fluxo básico (sucesso) | 761.092.776-73 |
| Múltipla autorização — aprovado | 238.242.640-30 |
| Múltipla autorização — rejeitado | 051.177.670-55 |
| Autenticação lenta | 002.502.737-99 |
| Erro forçado ao buscar dados | 163.511.711-99 |

Login no banco mock: usuário de teste fornecido na doc + senha `P@ssword01`.

## 7. Modelo de custo

| Plano | Custo | Cobertura |
|---|---|---|
| Sandbox | Gratuito, sem prazo | Ambiente de teste completo, até 20 contas conectadas em paralelo (trial de produção) |
| Trial de produção | Gratuito por 14 dias, sem cartão | Acesso completo à API em produção, até 20 contas |
| Básico | A partir de R$2.500/mês | Conexões Open Finance + diretas, widget customizável |
| Personalizado | Sob consulta | Volume adaptado, suporte premium |

**Característica importante**: custo é por **assinatura fixa**, não por consulta — diferente do modelo SERPRO (pago por unidade). Em volumes baixos de onboarding, o custo fixo pesa proporcionalmente mais; em volumes altos, tende a ficar mais barato que alternativas por consulta.

## 8. Reautenticação periódica — risco de reciclagem de número

### 8.1 A ameaça

O Balkao ancora identidade em número de WhatsApp. Números de celular no Brasil podem ser reciclados pela operadora: a Anatel permite que uma linha inativa por 60–90 dias seja cancelada e o número reatribuído a outra pessoa. Quando isso ocorre, a nova titular reativa o WhatsApp nesse número — o que automaticamente encerra a sessão do titular anterior — e passa a controlar, sem nenhuma reverificação, qualquer identidade que o Balkao tivesse associado àquele número.

Esse é um risco estrutural (depende de regra de operadora, não de erro do usuário) e, por isso, é o que esta arquitetura se propõe a mitigar.

### 8.2 Por que SMS sozinho não basta, mas continua necessário

Um SMS de reconfirmação enviado ao número cadastrado prova apenas que **alguém controla aquela linha agora** — se o número foi reciclado, é exatamente o novo titular (não a pessoa original) quem recebe e confirma esse SMS. SMS isolado não detecta a troca.

A camada que efetivamente detecta a troca é a **reauth bancária via Pluggy**: o novo titular do número não tem acesso à conta bancária vinculada ao CPF/CNPJ que o Balkao já tinha associado àquela identidade. Reabrir o Pluggy Connect Widget e tentar autenticar resulta em `identity_mismatch` — o CPF/CNPJ retornado pela Pluggy não bate com o que está cadastrado.

SMS continua tendo valor como primeira camada (mais rápida, mais barata, filtra número incorreto ou linha morta) antes de pedir a etapa mais pesada — mas não substitui a reauth bancária como mecanismo de bloqueio.

### 8.3 Estrutura de reautenticação

**Gatilho 1 — Reaparecimento após inatividade (> 45 dias sem verificação de SMS válida):**

```
Última verificação de SMS > 45 dias
  → nova interação no WhatsApp dispara:
      1. Verificação de SMS (confirma posse do número agora)
      2. Reauth bancária via Pluggy (confirma identidade financeira)
  → SMS falha → bloqueio + flag de risco (linha morta/portada)
  → SMS ok, mas CPF/CNPJ retornado pela Pluggy não bate com o cadastrado
      → identity_mismatch → bloqueia comprar/vender, sinaliza possível
        reciclagem de número
  → ambos confirmam → libera, reseta contador de 45 dias
```

**Gatilho 2 — Uso contínuo, sem inatividade (ciclo de rotina a cada 45 dias):**

```
Verificação de SMS < 45 dias E usuário manteve interação no WhatsApp
  → ao completar 45 dias desde a última verificação de SMS:
      1. Verificação de SMS (rotina)
  → reauth bancária NÃO é exigida neste ramo — não houve inatividade,
    logo não houve janela de risco de reciclagem desde a última verificação
```

A diferença entre os dois ramos: inatividade é o sinal que indica que pode ter havido troca de titularidade do número. Sem esse sinal, repetir a verificação bancária a cada 45 dias adicionaria fricção sem reduzir um risco que não esteve presente nesse intervalo.

### 8.4 Fora de escopo: SIM swap e engenharia social

Ataques de SIM swap (portabilidade fraudulenta da linha) ou engenharia social que resultem em tomada de conta durante uso ativo (sem inatividade) **não são tratados por esta arquitetura**, por decisão deliberada:

Esses ataques comprometem a própria raiz de confiança que qualquer verificação adicional usaria — se um atacante já controla a linha física (via SIM swap) ou convenceu o usuário a entregar credenciais (engenharia social), ele tipicamente tem acesso aos mesmos canais (celular, SMS) que uma camada extra de verificação dependeria para confirmar identidade. Não existe redesenho de fluxo de onboarding que resista a alguém que já controla os instrumentos de verificação. A mitigação para essa classe de ataque pertence a outra camada (segurança pessoal do usuário, monitoramento de padrão de uso, MFA que não dependa só do celular) — não ao desenho de verificação de identidade do Balkao.

## 9. O que este documento não cobre

- **Payment Initiation (Pix via Pluggy)**: fora de escopo aqui por decisão explícita. O fluxo de pagamento (comprador → escrow Balkao → vendedor) continua via Asaas, incluindo Pix e cartão.
- **Verificação documental (RG/CNH/passaporte + selfie/liveness)**: não coberto pela Pluggy. Caso o Balkao precise desse nível de verificação no futuro, a via segue sendo contrato comercial com Unico/idwall/Certta — avaliação separada.
- **Caso "autorizado mas não sócio, sem acesso bancário"**: se a empresa quiser autorizar alguém que não tem acesso à própria conta bancária (ex: procurador apenas para negociação, sem movimentação financeira), esse caso fica descoberto por este desenho — tratado como exceção manual, fora do fluxo automatizado.
- **SIM swap e engenharia social** (ver seção 8.4).
- **Provedor de SMS transacional**: a escolha de provedor (Twilio, Zenvia, TotalVoice, etc.) e o custo por envio ficam para avaliação separada — este documento assume apenas que o mecanismo de SMS existe e está integrado.

## 10. Estados sugeridos (para `BALKAO_ARQUITETURA.md`)

**Verificação inicial:**

```
pending_identity_verification
  → pluggy_widget_opened
  → pending_multi_approval (apenas PJ com múltipla alçada)
  → identity_mismatch (CPF/CNPJ declarado ≠ retornado pela Pluggy → rejeitar, solicitar reconexão)
  → identity_verified (sucesso — habilita papel de comprador E vendedor)
      last_sms_verification_at = now
      last_bank_reauth_at = now
```

**Reautenticação periódica (avaliada a cada nova interação no WhatsApp):**

```
SE (now - last_sms_verification_at) > 45 dias:
  → pending_reauth_full
      1. pending_sms_verification
         falha → blocked_risk_flag (linha morta/portada)
         sucesso → last_sms_verification_at = now
      2. pluggy_widget_opened (reauth bancária)
         identity_mismatch → blocked_possible_number_recycling
         sucesso → last_bank_reauth_at = now → verified, libera interação

SENÃO SE (now - last_sms_verification_at) > 45 dias É FALSO mas
         completou 45 dias desde a última verificação dentro de uso contínuo:
  → pending_sms_verification (rotina, sem reauth bancária)
      falha → blocked_risk_flag
      sucesso → last_sms_verification_at = now → verified

SENÃO:
  → verified (dentro da janela de 45 dias, segue normalmente)
```
