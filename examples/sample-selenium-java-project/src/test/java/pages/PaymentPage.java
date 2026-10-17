package pages;

public class PaymentPage {
  private String orderStatus = "PENDING";
  public void completePayment() { orderStatus = "SUCCESS"; }
  public String orderStatus() { return orderStatus; }
}
