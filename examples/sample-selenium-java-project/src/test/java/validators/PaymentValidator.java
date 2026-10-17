package validators;

public class PaymentValidator {
  public void assertOrderStatusSuccess(String actualStatus) { if (!"SUCCESS".equals(actualStatus)) throw new AssertionError("Expected SUCCESS but was " + actualStatus); }
}
