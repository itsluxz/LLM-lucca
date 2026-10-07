# Revisão visual

Referência gerada: [concept.png](concept.png), 1586×992. Capturas da implementação: [native-preview.png](native-preview.png) no mesmo tamanho, [desktop-preview.png](desktop-preview.png) em 1440×900, [mobile-preview.png](mobile-preview.png) em 390×844 e [chat-preview.png](chat-preview.png) após enviar uma sugestão.

Método: Playwright Core com Chrome local e respostas de API simuladas. O plugin Browser não estava disponível. A navegação e o streaming visual foram exercitados; PostgreSQL e provedores reais não participaram desta revisão.

| Ponto | Referência | Implementação e decisão |
|---|---|
| Paleta | Fundo roxo escuro, superfícies violeta, ação roxa e detalhes rosa/amarelo | Variáveis CSS aplicadas; contraste preservado nas capturas. |
| Estrutura | Sidebar à esquerda, seletor e uso no topo, composer fixo | Mesma hierarquia. A sidebar foi ampliada para 340 px após comparação em 1586×992. |
| Mascote e título | Mascote central grande acima da saudação | Quatro poses próprias de 500×500 com transparência; tamanho e posição ajustados. A arte final é mais detalhada que o pixel art do conceito. |
| Sugestões | Quatro cards na mesma linha com ícones de documento, escrita, ideia e código | Mesma ordem e ícones equivalentes; largura e altura ajustadas na tela nativa. |
| Composer | Barra no rodapé com anexo, contador e envio | Controles presentes e funcionais. A implementação usa uma barra mais compacta para deixar mais espaço ao histórico. |
| Texto e dados | O conceito ilustrava um modelo e conversas de exemplo | A interface mostra dados reais da API; no primeiro uso, a lista fica vazia. A captura usa um modelo simulado identificado como demonstração. |
| Celular | Continuação responsiva esperada | Drawer, cards em duas colunas e composer visíveis em 390×844; sem rolagem horizontal. |

Verificação automatizada: título e saudação visíveis, clique numa sugestão, duas mensagens renderizadas, contador de uso visível, nenhuma exceção de página e nenhuma rolagem horizontal nos três tamanhos testados.
