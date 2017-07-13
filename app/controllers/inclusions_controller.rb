class InclusionsController < ApplicationController
  def index
    @grouped_inclusions = UniquePiece.group(Inclusion.all)
  end
end
