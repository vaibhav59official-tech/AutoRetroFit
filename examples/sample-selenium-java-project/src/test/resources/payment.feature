@existing-payment
Feature: Payment
  Scenario: Existing payment flow
    Given the student is authenticated
    When the course is opened
    And the Master batch is selected
    And the payment is completed
    Then the order status is SUCCESS
