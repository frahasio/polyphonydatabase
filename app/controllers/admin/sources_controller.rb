module Admin
  class SourcesController < AdminControllerBase
    def index
    end

    def edit
      @source = Source.find(params[:id])
      @sources = Source.all

      @grouped_sources = @sources.each_with_object(Hash.new {|h, k| h[k] = []}) { |s, h|
        h[s.catalogued ? "Catalogued" : "Uncatalogued"] << [s.code, s.id]
      }

      @inclusions = @source.inclusions.order(:order).to_a

      last_inclusion = @inclusions.last
      last_order = last_inclusion&.order || -1

      @clefs_inclusions = {}
      @inclusions.each do |i|
        @clefs_inclusions[i] = i.clefs_inclusions.order(:id).to_a
        extra_clefs_needed = 8 - (i.clefs_inclusions.count % 8)

        extra_clefs_needed.times do
          @clefs_inclusions[i] << i.clefs_inclusions.build
        end
      end

      num_blank_rows = [10, (20 - @inclusions.count)].max

      num_blank_rows.times do |n|
        inclusion = @source.inclusions.build(order: last_order + n + 1)
        inclusion.piece = Piece.new

        attributions = inclusion.attributions.build
        attributions.anonym = Anonym.new

        8.times do
          inclusion.clefs_inclusions.build
        end

        @inclusions << inclusion
      end
    end

    def create
      source = Source.create!(source_params)

      unless source.persisted?
        flash[:error] = source.errors.full_messages.to_sentence
      end

      redirect_to admin_sources_path
    end

    def update
      source = Source.find(params[:id])

      unless source.update(source_params)
        flash[:error] = source.errors.full_messages.to_sentence
      end

      redirect_to edit_admin_source_path(source)
    end

    def switch_to
      redirect_to edit_admin_source_path(params[:id])
    end

  private

    def source_params
      params.require(:source).permit(
        :catalogued,
        :code,
        :format,
        :from_year_annotation,
        :from_year,
        :publisher_or_scribe,
        :rism_link,
        :title,
        :to_year_annotation,
        :to_year,
        :town,
        :type,
        :url,
        inclusions_attributes: [
          :attributed_to,
          :id,
          :notes,
          :order,
          clefs_inclusions_attributes: [
            :annotated_note,
            :id,
          ],
          piece_attributes: [
            :id,
            :title,
          ],
        ],
      )
    end
  end
end
