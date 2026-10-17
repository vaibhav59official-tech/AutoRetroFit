package stepdefinitions;

import helpers.AuthHelper;
import io.cucumber.java.en.And;
import io.cucumber.java.en.Given;
import io.cucumber.java.en.Then;
import io.cucumber.java.en.When;
import pages.CoursePage;
import pages.PaymentPage;
import validators.PaymentValidator;

public final class PaymentSteps {
  private final AuthHelper authHelper = new AuthHelper();
  private final CoursePage coursePage = new CoursePage();
  private final PaymentPage paymentPage = new PaymentPage();
  private final PaymentValidator paymentValidator = new PaymentValidator();

  @Given("the student is authenticated")
  public void authenticateStudent() { authHelper.loginAsStudent(); }
  @When("the course is opened")
  public void openCourse() { coursePage.openCourse(); }
  @And("the Master batch is selected")
  public void selectMasterBatch() { coursePage.selectMasterBatch(); }
  @And("the payment is completed")
  public void completePayment() { paymentPage.completePayment(); }
  @Then("the order status is SUCCESS")
  public void assertOrderStatus() { paymentValidator.assertOrderStatusSuccess(paymentPage.orderStatus()); }
}
