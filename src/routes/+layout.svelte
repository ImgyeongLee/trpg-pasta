<script lang="ts">
  // Pretendard (SIL OFL 1.1): 인터넷 없이 앱 안에서 읽는다. 유니코드 범위별로 쪼갠 파일이라 쓰는 글자 범위만 불러온다.
  import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
  import "../app.css";
  let { children } = $props();
</script>

{@render children()}
