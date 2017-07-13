class InclusionsController < ApplicationController
  def index
    @grouped_inclusions = Inclusion.all.group_by do |inclusion|
      composer_list = inclusion.composers.pluck(:id)&.join(",") || ""

      UniquePiece.find_or_initialize_by(
        title: inclusion&.piece&.title,
        composers: composer_list,
        minimum_voices: inclusion.minimum_voice_count,
      )
    end
  end
end
