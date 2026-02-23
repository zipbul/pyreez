/**
 * Unit tests for classifyByRules.
 */

import { describe, it, expect } from "bun:test";
import { classifyByRules } from "./classifier";

describe("classifyByRules", () => {
  // -- Happy Path: domain detection --

  it('should classify "함수를 구현해줘" as CODING/IMPLEMENT_FEATURE', () => {
    // Arrange & Act
    const result = classifyByRules("함수를 구현해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("CODING");
    expect(result!.taskType).toBe("IMPLEMENT_FEATURE");
  });

  it('should classify "리팩토링 해줘" as CODING/REFACTOR', () => {
    // Arrange & Act
    const result = classifyByRules("리팩토링 해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("CODING");
    expect(result!.taskType).toBe("REFACTOR");
  });

  it('should classify "테스트 작성해줘" as TESTING/UNIT_TEST_WRITE', () => {
    // Arrange & Act
    const result = classifyByRules("테스트 작성해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("TESTING");
    expect(result!.taskType).toBe("UNIT_TEST_WRITE");
  });

  it('should classify "버그 수정해줘" as DEBUGGING/FIX_IMPLEMENT', () => {
    // Arrange & Act
    const result = classifyByRules("버그 수정해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("DEBUGGING");
    expect(result!.taskType).toBe("FIX_IMPLEMENT");
  });

  it('should classify "코드 리뷰 해줘" as REVIEW/CODE_REVIEW', () => {
    // Arrange & Act
    const result = classifyByRules("코드 리뷰 해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("REVIEW");
    expect(result!.taskType).toBe("CODE_REVIEW");
  });

  it('should classify "아키텍처 설계" as ARCHITECTURE/SYSTEM_DESIGN', () => {
    // Arrange & Act
    const result = classifyByRules("아키텍처 설계해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("ARCHITECTURE");
    expect(result!.taskType).toBe("SYSTEM_DESIGN");
  });

  it('should classify "요약해줘" as COMMUNICATION/SUMMARIZE', () => {
    // Arrange & Act
    const result = classifyByRules("요약해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("COMMUNICATION");
    expect(result!.taskType).toBe("SUMMARIZE");
  });

  it('should classify "아이디어 내줘" as IDEATION/BRAINSTORM', () => {
    // Arrange & Act
    const result = classifyByRules("아이디어 내줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("IDEATION");
    expect(result!.taskType).toBe("BRAINSTORM");
  });

  it('should classify "계획 세워줘" as PLANNING/GOAL_DEFINITION', () => {
    // Arrange & Act
    const result = classifyByRules("계획 세워줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("PLANNING");
    expect(result!.taskType).toBe("GOAL_DEFINITION");
  });

  it('should classify "요구사항 정리" as REQUIREMENTS/REQUIREMENT_STRUCTURING', () => {
    // Arrange & Act
    const result = classifyByRules("요구사항 정리해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("REQUIREMENTS");
    expect(result!.taskType).toBe("REQUIREMENT_STRUCTURING");
  });

  it('should classify "배포 계획" as OPERATIONS/DEPLOY_PLAN', () => {
    // Arrange & Act
    const result = classifyByRules("배포 계획 세워줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("OPERATIONS");
    expect(result!.taskType).toBe("DEPLOY_PLAN");
  });

  it('should classify "벤치마크" as RESEARCH/BENCHMARK', () => {
    // Arrange & Act
    const result = classifyByRules("벤치마크 해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("RESEARCH");
    expect(result!.taskType).toBe("BENCHMARK");
  });

  // -- Happy Path: properties --

  it('should return method="rule" for rule-classified results', () => {
    // Arrange & Act
    const result = classifyByRules("함수를 구현해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.method).toBe("rule");
  });

  it('should classify English "implement a function" as CODING', () => {
    // Arrange & Act
    const result = classifyByRules("implement a function");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("CODING");
  });

  // -- Happy Path: complexity --

  it('should return "simple" complexity for short prompts', () => {
    // Arrange & Act
    const result = classifyByRules("함수 구현");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("simple");
  });

  it('should return "moderate" complexity for medium prompts', () => {
    // Arrange
    const mediumPrompt =
      "여러 파일에 걸쳐서 리팩토링을 진행해야 합니다. " +
      "기존의 인터페이스를 유지하면서 내부 구현을 변경하고, " +
      "관련된 테스트도 함께 수정해야 합니다. " +
      "의존성 그래프를 분석한 뒤 영향 범위를 파악하고 단계별로 진행해야 합니다.";

    // Act
    const result = classifyByRules(mediumPrompt);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });

  it('should return "complex" complexity for long prompts', () => {
    // Arrange
    const longPrompt =
      "대규모 마이크로서비스 아키텍처를 설계해야 합니다. ".repeat(20) +
      "각 서비스 간의 통신 프로토콜, 데이터베이스 분리 전략, " +
      "이벤트 소싱 패턴 적용, CQRS 구현, API Gateway 설계를 포함합니다.";

    // Act
    const result = classifyByRules(longPrompt);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("complex");
  });

  // -- Negative --

  it("should return null for empty string", () => {
    // Arrange & Act
    const result = classifyByRules("");

    // Assert
    expect(result).toBeNull();
  });

  it("should return null for unrecognized text", () => {
    // Arrange & Act
    const result = classifyByRules("xyzzy foobar 12345");

    // Assert
    expect(result).toBeNull();
  });

  // -- Edge --

  it("should match keyword at end of prompt", () => {
    // Arrange & Act
    const result = classifyByRules("이것 좀 리팩토링");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.taskType).toBe("REFACTOR");
  });

  it("should match case-insensitive keywords", () => {
    // Arrange & Act
    const result = classifyByRules("IMPLEMENT this feature");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.domain).toBe("CODING");
  });

  // -- Corner --

  it("should classify by first matching domain when prompt has multiple domain keywords", () => {
    // Arrange — "테스트" (TESTING) + "구현" (CODING)
    // The classifier should have a defined priority order
    const result = classifyByRules("테스트 구현해줘");

    // Assert — Should match one domain (not ambiguous)
    expect(result).not.toBeNull();
    expect(result!.domain).toBeDefined();
    expect(result!.taskType).toBeDefined();
  });

  // -- Idempotency --

  it("should return same result for same prompt on repeated calls", () => {
    // Arrange
    const prompt = "함수를 구현해줘";

    // Act
    const first = classifyByRules(prompt);
    const second = classifyByRules(prompt);

    // Assert
    expect(first).toEqual(second);
  });

  // -- Keyword-based complexity elevation --

  it('should return moderate when prompt contains "jwt" keyword', () => {
    // Arrange — short prompt with JWT keyword → CODING/IMPLEMENT_FEATURE, criticality=medium
    const result = classifyByRules("JWT 인증 구현해줘");

    // Assert — keyword "jwt" elevates simple → moderate
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });

  it('should return moderate when prompt contains Korean "보안" keyword', () => {
    // Arrange — "보안 리뷰" → REVIEW/SECURITY_REVIEW, criticality=critical
    const result = classifyByRules("보안 리뷰 해줘");

    // Assert — keyword "보안" + critical criticality → moderate
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });

  it('should return complex when prompt contains "마이크로서비스" keyword', () => {
    // Arrange — short prompt with complex keyword
    const result = classifyByRules("마이크로서비스 구현해줘");

    // Assert — complexKeyword overrides length-based simple
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("complex");
  });

  it('should return complex when prompt contains "architecture" keyword', () => {
    // Arrange — English complex keyword + classification-triggering keyword "코드"
    const result = classifyByRules("architecture 패턴으로 코드 구현해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("complex");
  });

  it('should return moderate when prompt contains "미들웨어" keyword', () => {
    // Arrange
    const result = classifyByRules("미들웨어 구현해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });

  it('should return moderate when prompt contains "database" keyword', () => {
    // Arrange
    const result = classifyByRules("database 연동 구현해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });

  it("should return moderate for critical criticality with short prompt", () => {
    // Arrange — "보안 검토" → REVIEW/SECURITY_REVIEW → criticality=critical
    // Even if "보안" is also a moderate keyword, criticality floor alone ensures moderate
    const result = classifyByRules("보안 검토 해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.criticality).toBe("critical");
    expect(result!.complexity).toBe("moderate");
  });

  it("should return moderate for high criticality with short prompt", () => {
    // Arrange — "시스템 설계" → ARCHITECTURE/SYSTEM_DESIGN → criticality=high
    const result = classifyByRules("시스템 설계");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.criticality).toBe("high");
    expect(result!.complexity).toBe("moderate");
  });

  it("should remain simple for medium criticality without keywords", () => {
    // Arrange — "함수 구현" → CODING/IMPLEMENT_FEATURE → criticality=medium, no complexity keywords
    const result = classifyByRules("함수 구현");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("simple");
  });

  it("should return complex for architecture keyword even with short prompt", () => {
    // Arrange — very short but contains complex keyword
    const result = classifyByRules("분산 시스템 구현");

    // Assert — complexKeyword overrides length
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("complex");
  });

  it("should match complexity keywords case-insensitively", () => {
    // Arrange — uppercase "JWT"
    const result = classifyByRules("JWT 구현해줘");

    // Assert
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });

  it("should return complex when both complex and moderate keywords present", () => {
    // Arrange — "분산" (complex) + "보안" (moderate)
    const result = classifyByRules("분산 시스템 보안 구현");

    // Assert — complex keyword takes priority
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("complex");
  });

  it("should remain complex for long prompt with moderate keywords", () => {
    // Arrange — long prompt (500+ chars) that already gets complex from length
    const longPrompt =
      "보안 인증 미들웨어를 구현합니다. ".repeat(30) +
      "JWT 와 OAuth 를 지원해야 합니다.";

    const result = classifyByRules(longPrompt);

    // Assert — already complex from length, moderate keyword doesn't downgrade
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("complex");
  });

  it("should return moderate when moderate keyword and moderate prompt length", () => {
    // Arrange — medium-length prompt with moderate keyword
    const mediumPrompt =
      "JWT 인증 미들웨어를 구현해야 합니다. " +
      "기존의 인터페이스를 유지하면서 내부 구현을 변경합니다.";

    const result = classifyByRules(mediumPrompt);

    // Assert — length says moderate, keyword says moderate → moderate
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });

  it("should return moderate for critical criticality with moderate keyword", () => {
    // Arrange — "보안 리뷰" = SECURITY_REVIEW, critical + "보안" moderate keyword
    const result = classifyByRules("보안 리뷰");

    // Assert — both keyword and criticality point to moderate
    expect(result).not.toBeNull();
    expect(result!.complexity).toBe("moderate");
  });
});
