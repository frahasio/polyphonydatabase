class InclusionsController < ApplicationController
  def index
    @grouped_inclusions = Inclusion.all.group_by do |inclusion|
      [
        inclusion&.piece&.title,
        inclusion.composers,
        3,
      ]
    end
  end
end
